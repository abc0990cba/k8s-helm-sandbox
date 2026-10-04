# shellcheck shell=bash
#
# remote-env.sh — shared helpers for the lan/vps targets. Not executable;
# scripts source it:
#
#   source "$(dirname "$0")/remote-env.sh"
#   load_target lan          # → R_NAME R_HOST R_USER   (from ansible/inventory.ini)
#   open_tunnel              # → TUNNEL_PID (127.0.0.1:16443 → target:6443)
#   kubeconfig_for_target    # → exports KUBECONFIG (server rewritten to the tunnel)
#   app_domains              # → R_SCHEME R_APP_HOST R_AUTH_HOST (from values-<t>.yaml)
#   close_tunnel
#
# The ansible inventory is the single source of truth for machine facts; the
# chart overlays (helm-chart/values-<target>.yaml) are the single source of
# truth for domains/TLS.

die()  { printf '✖ %s\n' "$*" >&2; exit 1; }
info() { printf '→ %s\n' "$*"; }
pass() { printf '✔ %s\n' "$*"; }
warn() { printf '!  %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

REMOTE_REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

load_target() {
  local target="$1" inv="$REMOTE_REPO_DIR/ansible/inventory.ini" line
  case "$target" in
    lan|vps|orbstack) ;;
    *) die "unknown target '$target' — expected lan|vps|orbstack (plain ./start = local minikube)" ;;
  esac
  [ -f "$inv" ] || die "ansible/inventory.ini not found.
   Copy the sample and fill in your $target machine:
     cp ansible/inventory.sample.ini ansible/inventory.ini"
  line=$(awk -v sec="$target" '
      $0 ~ "^\\[" sec "\\]" { insec = 1; next }
      /^\[/                 { insec = 0 }
      insec && /ansible_host=/ { print; exit }
    ' "$inv")
  [ -n "$line" ] || die "no host with 'ansible_host=' under [$target] in ansible/inventory.ini
   for the orbstack target, create the machine first:  scripts/orbstack-create.sh"
  R_NAME="$target"
  R_HOST=$(printf '%s' "$line" | sed -n 's/.*ansible_host=\([^ ]*\).*/\1/p')
  R_USER=$(printf '%s' "$line" | sed -n 's/.*ansible_user=\([^ ]*\).*/\1/p')
  R_USER=${R_USER:-root}
  # optional ansible_port= in the inventory — used by the NAT/port-forward
  # fallback (docs/DEPLOY-LAN-VIRTUALBOX.md) where the VM's ssh is reachable
  # only through a forwarded port on the Windows host
  R_PORT=$(printf '%s' "$line" | sed -n 's/.*ansible_port=\([^ ]*\).*/\1/p')
  R_PORT=${R_PORT:-22}
  [ -n "$R_HOST" ] || die "[$target] entry in ansible/inventory.ini has no ansible_host="
}

open_tunnel() {
  # 6443 (k8s API) is deliberately firewalled on the target; everything goes
  # through ssh. 16443 is our fixed local end.
  info "opening SSH tunnel 127.0.0.1:16443 → $R_USER@$R_HOST:$R_PORT → 6443"
  ssh -N -L 16443:127.0.0.1:6443 \
      -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
      -p "$R_PORT" \
      "$R_USER@$R_HOST" &
  TUNNEL_PID=$!
  local i
  for i in $(seq 1 30); do
    if nc -z 127.0.0.1 16443 >/dev/null 2>&1; then
      pass "tunnel up"
      return 0
    fi
    kill -0 "$TUNNEL_PID" 2>/dev/null || die "ssh tunnel died — check: ssh -p $R_PORT $R_USER@$R_HOST"
    sleep 1
  done
  die "tunnel did not come up within 30 s"
}

close_tunnel() {
  if [ -n "${TUNNEL_PID:-}" ]; then
    kill "$TUNNEL_PID" >/dev/null 2>&1 || true
    wait "$TUNNEL_PID" 2>/dev/null || true
  fi
}

kubeconfig_for_target() {
  local raw="$REMOTE_REPO_DIR/.local/kubeconfig-$R_NAME.raw.yaml"
  local cfg="$REMOTE_REPO_DIR/.local/kubeconfig-$R_NAME.yaml"
  [ -f "$raw" ] || die "$raw not found — the bootstrap writes it; run: ./start $R_NAME"
  sed 's|server: https://127.0.0.1:6443|server: https://127.0.0.1:16443|' "$raw" > "$cfg"
  chmod 600 "$cfg"
  export KUBECONFIG="$cfg"
}

app_domains() {
  local vf="$REMOTE_REPO_DIR/helm-chart/values-$R_NAME.yaml"
  [ -f "$vf" ] || die "$vf missing"
  R_SCHEME=$(awk '/^host:/{f=1; next} f && /^  scheme:/{print $2; exit}' "$vf")
  R_APP_HOST=$(awk '/^host:/{f=1; next} f && /^  app:/{print $2; exit}' "$vf")
  R_AUTH_HOST=$(awk '/^host:/{f=1; next} f && /^  auth:/{print $2; exit}' "$vf")
  R_SCHEME=${R_SCHEME:-http}
}

# wait for the ArgoCD Application `ap` to be Healthy/Synced
wait_for_app() {
  local deadline=$(( $(date +%s) + ${APP_WAIT_SECONDS:-1800} )) state
  info "waiting for ArgoCD application 'ap' (first deploy pulls every image — be patient)"
  while [ "$(date +%s)" -lt "$deadline" ]; do
    state=$(kubectl -n argocd get application ap \
              -o jsonpath='{.status.health.status}/{.status.sync.status}' 2>/dev/null || echo "?")
    case "$state" in
      Healthy/Synced) pass "application 'ap' → Healthy/Synced"; return 0 ;;
      Degraded/*|*/Degraded)
        die "application 'ap' is $state — inspect: kubectl -n argocd describe application ap" ;;
    esac
    printf '   argocd: %s\r' "$state"
    sleep 10
  done
  die "timed out waiting for 'ap' (last state: $state)"
}

# smoke tests mirroring scripts/local-up.sh, addressed via --resolve so no
# hosts-file edits are required on this machine
run_smoke() {
  local port=80
  [ "$R_SCHEME" = "https" ] && port=443
  CURL_AT() { local host="$1" path="$2"; shift 2
              curl -sk --max-time 5 --resolve "$host:$port:$R_HOST" "$R_SCHEME://$host$path" "$@"; }
  smoke() { # name host path expected_code [extra curl args…]
    local name="$1" host="$2" path="$3" want="$4" code="" i
    shift 4
    for i in $(seq 1 30); do
      code=$(CURL_AT "$host" "$path" "$@" -o /dev/null -w '%{http_code}' 2>/dev/null || echo 000)
      [ "$code" = "$want" ] && { pass "$name → HTTP $code"; return 0; }
      sleep 2
    done
    warn "$name: expected HTTP $want, got ${code:-none} — $R_SCHEME://$host$path"
    if [ "$R_SCHEME" = "https" ] && [ "$code" != "200" ]; then
      warn "https may still be issuing its certificate — check DNS + 'kubectl -n default get certificate'"
    fi
    return 1
  }

  info "smoke tests against $R_HOST (port $port)"
  local rc=0
  smoke "react front          " "$R_APP_HOST"  "/"                                     200 || rc=1
  smoke "krakend gateway      " "$R_APP_HOST"  "/api/healthz"                          200 || rc=1
  smoke "nodejs public api    " "$R_APP_HOST"  "/api/v1/nodejs/public"                 200 || rc=1
  smoke "golang public api    " "$R_APP_HOST"  "/api/v1/golang/public"                 200 || rc=1
  smoke "golang fibonacci(10) " "$R_APP_HOST"  "/api/v1/golang/public/fibonacci/10"    200 || rc=1
  smoke "keycloak realm       " "$R_AUTH_HOST" "/realms/demorealm"                     200 || rc=1

  local token_json token
  token_json=$(CURL_AT "$R_AUTH_HOST" "/realms/demorealm/protocol/openid-connect/token" --max-time 10 \
                 -d "grant_type=password&client_id=reactclient&username=demo&password=demo")
  token=$(printf '%s' "$token_json" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
  if [ -n "$token" ]; then
    pass "seeded user login OK (JWT obtained)"
    smoke "nodejs private api   " "$R_APP_HOST"  "/api/v1/nodejs/private" 200 -H "Authorization: Bearer $token" || rc=1
    smoke "golang private api   " "$R_APP_HOST"  "/api/v1/golang/private" 200 -H "Authorization: Bearer $token" || rc=1
  else
    warn "no access token from Keycloak — response: $(printf '%s' "$token_json" | head -c 200)"
    rc=1
  fi
  return "$rc"
}
