#!/usr/bin/env bash
#
# local-up.sh — bring the whole stack up on local Minikube with zero manual steps.
#
# Idempotent: safe to re-run at any time (it resumes/repairs instead of failing).
# What it does: preflight checks -> minikube + addons -> /etc/hosts -> gpg/sops
# setup -> helm install/upgrade -> wait for readiness -> minikube tunnel ->
# end-to-end smoke tests through the ingress.
#
# Flags:
#   --metrics         enable Prometheus + Grafana (kube-prometheus-stack subchart)
#   --load-generator  enable the busybox load generator (HPA stress test)
#   --check-only      run preflight checks and exit
#   --skip-smoke      skip the end-to-end smoke tests
#   --reset           delete the minikube profile first (clean slate; wipes
#                     in-cluster demo data, it is re-seeded on start)
#
# Env overrides (optional): SOPS_PASSPHRASE, SEED_USER, SEED_PASS, REALM
#
# Notes:
#   * sudo is needed twice: to append entries to /etc/hosts (first run only)
#     and to run `minikube tunnel` (must run as root). The script asks once.
#   * To make SOPS decryption non-interactive, the demo key passphrase is
#     preset in gpg-agent (requires `allow-preset-passphrase` in
#     ~/.gnupg/gpg-agent.conf — appended once by this script).
#   * If `minikube start` fails because the profile is corrupted (typical
#     after Ctrl-C mid-run: empty /etc/kubernetes/pki, kubelet crash-looping),
#     the script says so, deletes the broken profile and recreates the cluster
#     automatically. In-cluster demo data (postgres hostPath PV) is wiped and
#     re-seeded by the migration job. `./start --reset` forces the same.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$REPO_DIR/.local"
TUNNEL_LOG="$LOG_DIR/tunnel.log"
MK_LOG="$LOG_DIR/minikube-start.log"
RELEASE="ap"
CHART_DIR="$REPO_DIR/helm-chart"
SOPS_FILE="$REPO_DIR/secrets.yaml"
GPG_KEY_FILE="$REPO_DIR/demo-secret-key.asc"
SOPS_FINGERPRINT="$(sed -n 's/.*pgp: *"\([0-9A-F]*\)".*/\1/p' "$REPO_DIR/.sops.yaml" | head -1)"
SOPS_PASSPHRASE="${SOPS_PASSPHRASE:-example1}"
SEED_USER="${SEED_USER:-demo}"     # must match values.yaml auth.seedUser
SEED_PASS="${SEED_PASS:-demo}"
REALM="${REALM:-demorealm}"
HOST_ENTRIES=(auth.test grogu.test grafana.test prom.test)

ENABLE_METRICS=false
ENABLE_LOADGEN=false
CHECK_ONLY=false
SKIP_SMOKE=false
RESET=false
for arg in "$@"; do
  case "$arg" in
    --metrics)        ENABLE_METRICS=true ;;
    --load-generator) ENABLE_LOADGEN=true ;;
    --check-only)     CHECK_ONLY=true ;;
    --skip-smoke)     SKIP_SMOKE=true ;;
    --reset)          RESET=true ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

mkdir -p "$LOG_DIR"

# ---------------------------------------------------------------- UI helpers
if [ -t 1 ]; then
  C_G=$'\033[32m'; C_R=$'\033[31m'; C_Y=$'\033[33m'; C_B=$'\033[1m'; C_0=$'\033[0m'
else
  C_G=""; C_R=""; C_Y=""; C_B=""; C_0=""
fi
step()    { printf '\n%s==> %s%s\n' "$C_B" "$*" "$C_0"; }
info()    { printf '    %s\n' "$*"; }
pass()    { printf '%s  ✔ %s%s\n' "$C_G" "$*" "$C_0"; }
warn()    { printf '%s  ! %s%s\n' "$C_Y" "$*" "$C_0"; }
die()     { printf '%s  ✘ %s%s\n' "$C_R" "$*" "$C_0"; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

# remember the command about to run, so the ERR trap can name it;
# clear it on success (a failure exits before the clear, so the trap
# always names the command that actually failed)
mark() { LAST_CMD="$*"; }

# kubectl fallback: minikube ships its own kubectl
if have kubectl; then
  K() { kubectl "$@"; }
else
  K() { minikube kubectl -- "$@"; }
fi

ensure_sudo() {
  sudo -n true 2>/dev/null && return 0
  info "sudo password required for: $*"
  sudo -v
}

cleanup_on_error() {
  local rc=$?
  local ln="${BASH_LINENO[0]:-0}"
  local what="${LAST_CMD:-$(sed -n "${ln}p" "${BASH_SOURCE[0]}" 2>/dev/null | sed 's/^[[:space:]]*//')}"
  printf '\n%s✘ failed at: %s (line %d)%s\n' "$C_R" "${what:-unknown}" "$ln" "$C_0" >&2 || true
  printf 'Hints:\n' >&2
  printf '  * re-run ./start — it is idempotent and resumes where it stopped\n' >&2
  printf '  * pod problems:  make status   (or: kubectl get pods)\n' >&2
  printf '  * minikube log:  %s\n' "$MK_LOG" >&2
  printf '  * tunnel log:    %s\n' "$TUNNEL_LOG" >&2
  printf '  * still stuck:   ./start --reset  (wipes the cluster, re-seeds demo data)\n' >&2
  exit "$rc"
}
LAST_CMD=""
trap cleanup_on_error ERR

# ------------------------------------------------------------ 1. preflight
step "Preflight: checking prerequisites"
MISSING=()
for cmd in docker minikube helm sops gpg; do
  if have "$cmd"; then pass "$cmd found"; else MISSING+=("$cmd"); fi
done
if [ ${#MISSING[@]} -gt 0 ]; then
  die "Missing: ${MISSING[*]} — install with: brew install ${MISSING[*]/docker/docker--desktop} (docker: install Docker Desktop; gpg: brew install gnupg)"
fi
if ! helm plugin list 2>/dev/null | grep -qi '^secrets'; then
  warn "helm-secrets plugin missing — install with: helm plugin install https://github.com/jkroepke/helm-secrets --version v4.6.2 (launch still works: secrets are decrypted via sops directly; 'make secrets-edit' needs the plugin)"
else
  pass "helm-secrets plugin found"
fi
[ -f "$SOPS_FILE" ]    || die "$SOPS_FILE not found"
[ -f "$GPG_KEY_FILE" ] || die "$GPG_KEY_FILE not found"
[ -n "$SOPS_FINGERPRINT" ] || die "could not read PGP fingerprint from .sops.yaml"

if ! docker info >/dev/null 2>&1; then
  step "Docker daemon not running — starting Docker Desktop"
  open -a Docker || die "could not launch Docker Desktop"
  for _ in $(seq 1 60); do
    docker info >/dev/null 2>&1 && break
    sleep 2
  done
  docker info >/dev/null 2>&1 || die "Docker daemon did not come up within 120s — start Docker Desktop manually and re-run"
fi
pass "docker daemon is running"

if [ "$CHECK_ONLY" = true ]; then
  pass "check-only mode: preflight OK"
  exit 0
fi

# ------------------------------------------------------ 2. minikube + addons
if [ "$RESET" = true ]; then
  step "--reset: deleting the minikube profile for a clean slate"
  warn "in-cluster state is wiped (postgres hostPath PV — demo data is re-seeded by the migration job)"
  mark "minikube delete -p minikube"
  minikube delete -p minikube >/dev/null 2>&1 || true
  LAST_CMD=""
  pass "profile deleted"
fi

if ! minikube status -p minikube 2>/dev/null | grep -q "host: Running"; then
  step "Starting minikube cluster (docker driver, calico CNI)"
  # size the VM for this chart: its pods request ~5Gi RAM / ~2.6 CPU in total.
  # minikube runs INSIDE the Docker Desktop VM, so size it from the docker
  # daemon's limits, not from the host (Docker Desktop caps VM memory).
  if [ "$(uname)" = "Darwin" ]; then
    TOTAL_CPU=$(sysctl -n hw.ncpu)
  else
    TOTAL_CPU=$(nproc)
  fi
  DOCKER_MEM_MB=$(docker info --format '{{.MemTotal}}' 2>/dev/null | awk '{print int($1/1024/1024)}')
  DOCKER_CPU=$(docker info --format '{{.NCPU}}' 2>/dev/null || echo "$TOTAL_CPU")
  if [ -z "$DOCKER_MEM_MB" ] || [ "$DOCKER_MEM_MB" -le 0 ] 2>/dev/null; then
    warn "could not read docker daemon memory — falling back to host sizing"
    if [ "$(uname)" = "Darwin" ]; then
      DOCKER_MEM_MB=$(( $(sysctl -n hw.memsize) / 1024 / 1024 ))
    else
      DOCKER_MEM_MB=$(( $(grep MemTotal /proc/meminfo | awk '{print $2}') / 1024 ))
    fi
  fi
  # -2: leave headroom for the Docker VM itself and other containers in it
  MEM_GB=$(( DOCKER_MEM_MB / 1024 - 2 )); [ "$MEM_GB" -lt 4 ] && MEM_GB=4; [ "$MEM_GB" -gt 12 ] && MEM_GB=12
  CPU=$(( TOTAL_CPU / 2 )); [ "$CPU" -lt 4 ] && CPU=4; [ "$CPU" -gt 8 ] && CPU=8
  [ "$CPU" -gt "$DOCKER_CPU" ] && CPU="$DOCKER_CPU"
  if [ "$MEM_GB" -lt 6 ]; then
    warn "docker VM has only ${DOCKER_MEM_MB}MB — minikube sized to ${MEM_GB}g; the chart requests ~5Gi and pods may not all fit"
  fi
  info "minikube resources: ${MEM_GB}g RAM, ${CPU} CPUs"
  # full output goes to $MK_LOG (it is the first place to look when start fails);
  # pipefail in the if-condition gives us minikube's exit code without killing the script
  if ! minikube start --driver=docker --cni=calico --memory="${MEM_GB}g" --cpus="${CPU}" 2>&1 | tee "$MK_LOG"; then
    step "minikube start failed — the real error (full log: $MK_LOG):"
    grep -E 'Exiting due|error validating|returned an error|Failed to start|E[0-9]{4}' "$MK_LOG" | sed 's/^\* //' | sort -u | head -8 >&2 || true
    warn "this usually means the existing profile is corrupted (e.g. Ctrl-C during an earlier ./start left the node half-wiped)"
    warn "auto-repair: deleting the broken minikube profile and recreating the cluster from scratch"
    warn "in-cluster state is wiped (postgres hostPath PV — demo data is re-seeded by the migration job)"
    mark "minikube delete -p minikube (auto-repair)"
    minikube delete -p minikube >>"$MK_LOG" 2>&1 || true
    LAST_CMD=""
    mark "minikube start (after auto-repair)"
    if ! minikube start --driver=docker --cni=calico --memory="${MEM_GB}g" --cpus="${CPU}" >>"$MK_LOG" 2>&1; then
      tail -n 25 "$MK_LOG" >&2
      die "minikube start failed even after a profile reset — full log: $MK_LOG"
    fi
    LAST_CMD=""
    pass "cluster recreated after profile reset"
  fi
else
  step "Minikube cluster already running — reusing it"
fi
pass "cluster is up"

step "Enabling minikube addons"
for addon in metrics-server ingress ingress-dns storage-provisioner default-storageclass dashboard; do
  minikube addons enable "$addon" >/dev/null 2>&1 && pass "addon: $addon" || warn "addon $addon failed (may already be enabled)"
done

# the ingress addon ships an admission webhook with failurePolicy=Fail: until the
# controller and its certgen jobs are up, every Ingress object is rejected — a
# helm run straight after cluster creation fails with "failed calling webhook
# validate.nginx.ingress.kubernetes.io ... connection refused"
info "waiting for the ingress-nginx controller + admission webhook to become ready"
mark "kubectl wait: ingress-nginx controller/certgen jobs ready"
K wait --for=condition=available --timeout=300s deployment/ingress-nginx-controller -n ingress-nginx >/dev/null 2>&1 \
  || warn "ingress-nginx controller not Available within 5 min — the helm step may fail on Ingress validation; re-run ./start"
for j in ingress-nginx-admission-create ingress-nginx-admission-patch; do
  K wait --for=condition=complete --timeout=300s "job/$j" -n ingress-nginx >/dev/null 2>&1 \
    || warn "job $j not complete — the helm step may fail on Ingress validation; re-run ./start"
done
LAST_CMD=""
pass "ingress controller and admission webhook ready"

# ------------------------------------------------------------ 3. /etc/hosts
step "Checking /etc/hosts entries"
NEED_HOSTS=()
for h in "${HOST_ENTRIES[@]}"; do
  grep -qE "^[[:space:]]*127\.0\.0\.1[[:space:]].*$h" /etc/hosts || NEED_HOSTS+=("$h")
done
if [ ${#NEED_HOSTS[@]} -gt 0 ]; then
  ensure_sudo "appending ${NEED_HOSTS[*]} to /etc/hosts"
  for h in "${NEED_HOSTS[@]}"; do
    mark "sudo tee -a /etc/hosts (add $h)"
    printf '127.0.0.1 %s\n' "$h" | sudo -n tee -a /etc/hosts >/dev/null
    LAST_CMD=""
    pass "added: 127.0.0.1 $h"
  done
else
  pass "all host entries already present"
fi

# -------------------------------------------------- 4. gpg + sops (no prompts)
step "Setting up SOPS/GPG decryption (non-interactive)"
export GPG_TTY="${GPG_TTY:-$(tty 2>/dev/null || true)}"
if ! gpg --list-secret-keys 2>/dev/null | grep -qi "$SOPS_FINGERPRINT"; then
  mark "gpg --import $GPG_KEY_FILE"
  gpg --batch --pinentry-mode loopback --passphrase "$SOPS_PASSPHRASE" --import "$GPG_KEY_FILE"
  LAST_CMD=""
  pass "imported demo key $SOPS_FINGERPRINT"
else
  pass "demo key already imported"
fi

GPG_AGENT_CONF="$HOME/.gnupg/gpg-agent.conf"
if ! grep -q "^allow-preset-passphrase" "$GPG_AGENT_CONF" 2>/dev/null; then
  mkdir -p "$HOME/.gnupg"; chmod 700 "$HOME/.gnupg"
  echo "allow-preset-passphrase" >> "$GPG_AGENT_CONF"
  info "added allow-preset-passphrase to $GPG_AGENT_CONF (one-time)"
fi
gpg-connect-agent reloadagent /bye >/dev/null 2>&1 || true
KEYGRIPS=$(gpg --with-keygrip --list-secret-keys "$SOPS_FINGERPRINT" 2>/dev/null | awk '/[Kk]eygrip/ {print $NF}')
if [ -n "$KEYGRIPS" ]; then
  # the file is encrypted to the encryption SUBKEY, whose keygrip differs from
  # the primary key's — preset the passphrase for every keygrip of this key
  PASS_HEX=$(printf '%s' "$SOPS_PASSPHRASE" | xxd -p | tr -d '\n')
  PRESET_OK=true
  for kg in $KEYGRIPS; do
    gpg-connect-agent "PRESET_PASSPHRASE $kg -1 $PASS_HEX" /bye >/dev/null 2>&1 || PRESET_OK=false
  done
  [ "$PRESET_OK" = true ] && pass "passphrase preset in gpg-agent (sops will not prompt)" \
    || warn "could not preset passphrase — sops may prompt for '$SOPS_PASSPHRASE' once"
fi
sops -d "$SOPS_FILE" >/dev/null 2>&1 && pass "secrets.yaml decrypts cleanly" \
  || die "secrets.yaml decryption failed — check SOPS_PASSPHRASE (default: example1)"

# ----------------------------------------------------- 5. helm install/upgrade
step "Installing/upgrading helm release '$RELEASE'"
HELM_SET=()
[ "$ENABLE_METRICS" = true ]   && HELM_SET+=(--set metrics.enabled=true)
[ "$ENABLE_LOADGEN" = true ]   && HELM_SET+=(--set loadGenerator.enable=true)
# vendored charts/ dir makes `helm dependency update` unnecessary here
# (the ${arr[@]+...} idiom avoids bash-3.2 "unbound variable" on empty arrays)
HELM_ARGS=(-f "$SOPS_FILE" --wait --timeout 15m ${HELM_SET[@]+"${HELM_SET[@]}"})
if helm secrets version >/dev/null 2>&1; then
  mark "helm secrets upgrade --install $RELEASE"
  helm secrets upgrade --install "$RELEASE" "$CHART_DIR" "${HELM_ARGS[@]}" 2>&1 | grep -vE '^\[helm-secrets\]' | tail -5
  LAST_CMD=""
else
  # plugin missing or incompatible with this helm — hand it decrypted values ourselves
  warn "helm-secrets plugin not usable — decrypting secrets.yaml to a temp file for this install"
  DEC=$(mktemp -t secrets-decrypted)
  sops -d "$SOPS_FILE" > "$DEC"
  mark "helm upgrade --install $RELEASE"
  helm upgrade --install "$RELEASE" "$CHART_DIR" -f "$DEC" "${HELM_ARGS[@]:1}" 2>&1 | tail -5
  LAST_CMD=""
  rm -f "$DEC"
fi
pass "helm release '$RELEASE' deployed"

# --------------------------------------------------------- 6. wait for pods
step "Waiting for all pods to be Ready"
mark "kubectl get pods (waiting for all pods to become Ready)"
# "Completed" counts as ready: the postgres migration Job finishes and exits 0
DEADLINE=$(( $(date +%s) + 420 ))
while :; do
  TOTAL=$(K get pods --no-headers 2>/dev/null | wc -l | tr -d ' ')
  READY=$(K get pods --no-headers 2>/dev/null \
    | awk '{split($2,a,"/"); if ($3=="Completed" || (a[1]==a[2] && a[2]>0 && $3=="Running")) n++} END {print n+0}')
  if [ "$TOTAL" -gt 0 ] && [ "$READY" -eq "$TOTAL" ]; then
    pass "all $TOTAL pods Ready"
    LAST_CMD=""
    break
  fi
  if [ "$(date +%s)" -gt "$DEADLINE" ]; then
    K get pods
    die "pods not Ready within 7 min — see 'kubectl get pods' output above"
  fi
  info "waiting: $READY/$TOTAL pods ready..."
  sleep 10
done

# --------------------------------------------------------- 7. minikube tunnel
# The tunnel routes *.test (127.0.0.1) into the ingress and must run as root.
# Non-interactive fallback (no sudo/no TTY): port-forward the ingress to a
# local port so smoke tests still work; user re-runs ./start in a terminal
# afterwards to get the real tunnel.
step "Ensuring minikube tunnel is running (routes *.test to localhost)"
PF_MODE=false
if pgrep -f "minikube tunnel" >/dev/null 2>&1; then
  pass "tunnel already running"
elif sudo -n true 2>/dev/null || [ -t 0 ]; then
  ensure_sudo "starting minikube tunnel (routes LoadBalancer/ingress to 127.0.0.1)"
  nohup sudo -n minikube tunnel >"$TUNNEL_LOG" 2>&1 &
  TUNNEL_DEADLINE=$(( $(date +%s) + 90 ))
  until curl -s -o /dev/null --max-time 2 http://127.0.0.1/; do
    if [ "$(date +%s)" -gt "$TUNNEL_DEADLINE" ]; then
      die "tunnel is not forwarding port 80 — check $TUNNEL_LOG, then re-run ./start"
    fi
    info "waiting for tunnel to forward 127.0.0.1:80 ..."
    sleep 3
  done
  pass "tunnel forwards 127.0.0.1:80 to the ingress"
else
  warn "no sudo available in this non-interactive session — falling back to kubectl port-forward"
  PF_MODE=true
  # kill stale forwards from earlier runs; a hardcoded port could be taken by
  # another app (the forward would silently die and smoke tests would hit it)
  pkill -f "port-forward -n ingress-nginx" 2>/dev/null || true
  : > "$LOG_DIR/port-forward.log"
  # NOTE: nohup cannot run the K() bash function — call kubectl/minikube directly
  if have kubectl; then
    nohup kubectl port-forward -n ingress-nginx svc/ingress-nginx-controller ":80" \
      >"$LOG_DIR/port-forward.log" 2>&1 &
  else
    nohup minikube kubectl -- port-forward -n ingress-nginx svc/ingress-nginx-controller ":80" \
      >"$LOG_DIR/port-forward.log" 2>&1 &
  fi
  PF_DEADLINE=$(( $(date +%s) + 90 ))
  PF_PORT=""
  while :; do
    # `|| true`: with pipefail, a no-match grep would kill the script.
    # tail -1: a service forward can reconnect and advertise a NEW port.
    PF_PORT=$(grep -oE '127\.0\.0\.1:[0-9]+' "$LOG_DIR/port-forward.log" 2>/dev/null | tail -1 | cut -d: -f2 || true)
    if [ -n "$PF_PORT" ] && curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PF_PORT/"; then
      break
    fi
    if [ "$(date +%s)" -gt "$PF_DEADLINE" ]; then
      die "port-forward to the ingress did not start — check $LOG_DIR/port-forward.log"
    fi
    info "waiting for port-forward on 127.0.0.1:${PF_PORT:-?} ..."
    sleep 2
  done
  pass "ingress reachable via 127.0.0.1:$PF_PORT (smoke tests only)"
  warn "URLs will NOT resolve in a browser until the tunnel runs: re-run ./start in a terminal"
fi

# --------------------------------------------------------- 8. smoke tests
if [ "$SKIP_SMOKE" = true ]; then
  info "smoke tests skipped (--skip-smoke)"
else
  step "Smoke tests (through the ingress, like a real browser)"
  # http host path  -> tunnel mode: http://host/path, pf mode: --resolve host:PF_PORT
  if [ "$PF_MODE" = true ]; then
    CURL_AT() { curl -s --resolve "$1:$PF_PORT:127.0.0.1" "$@"; }
    URL_AT()  { echo "http://$1:$PF_PORT$2"; }
  else
    CURL_AT() { curl -s "$@"; }
    URL_AT()  { echo "http://$1$2"; }
  fi

  smoke() { # name host path expected_code
    local name="$1" host="$2" path="$3" want="$4" code="" i url
    url=$(URL_AT "$host" "$path")
    for i in $(seq 1 30); do
      code=$(CURL_AT -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || echo 000)
      [ "$code" = "$want" ] && { pass "$name → HTTP $code"; return 0; }
      sleep 2
    done
    die "$name: expected HTTP $want, got ${code:-none} — $url"
  }

  smoke "react front          " grogu.test "/"                   200
  smoke "krakend gateway      " grogu.test "/api/healthz"        200
  smoke "nodejs public api    " grogu.test "/api/v1/nodejs/public" 200
  smoke "golang public api    " grogu.test "/api/v1/golang/public" 200
  smoke "golang fibonacci(10) " grogu.test "/api/v1/golang/public/fibonacci/10" 200
  smoke "keycloak realm       " auth.test  "/realms/$REALM"      200

  info "requesting access token for seeded user '$SEED_USER' (password grant)"
  mark "curl: request JWT from Keycloak for user '$SEED_USER'"
  TOKEN_URL=$(URL_AT auth.test "/realms/$REALM/protocol/openid-connect/token")
  TOKEN_JSON=$(CURL_AT --max-time 10 \
    -d "grant_type=password&client_id=reactclient&username=$SEED_USER&password=$SEED_PASS" \
    "$TOKEN_URL")
  LAST_CMD=""
  TOKEN=$(printf '%s' "$TOKEN_JSON" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
  [ -n "$TOKEN" ] || die "no access token from Keycloak — seeded user login failed. Response: $(printf '%s' "$TOKEN_JSON" | head -c 200)"
  pass "seeded user login OK (JWT obtained)"

  auth_smoke() { # name host path
    local name="$1" host="$2" path="$3" code="" i url
    url=$(URL_AT "$host" "$path")
    for i in $(seq 1 20); do
      code=$(CURL_AT -o /dev/null -w '%{http_code}' --max-time 5 -H "Authorization: Bearer $TOKEN" "$url" 2>/dev/null || echo 000)
      [ "$code" = "200" ] && { pass "$name → HTTP 200 (JWT validated by gateway)"; return 0; }
      sleep 2
    done
    die "$name: expected HTTP 200 with token, got ${code:-none} — $url"
  }
  auth_smoke "nodejs private api " grogu.test "/api/v1/nodejs/private"
  auth_smoke "golang private api " grogu.test "/api/v1/golang/private"
fi

# --------------------------------------------------------------- summary
step "✔ Everything is up"
cat <<EOF

  App (login: $SEED_USER / $SEED_PASS)   http://grogu.test/
  Keycloak admin (admin / admin)         http://auth.test/      (realm: $REALM)
  API via gateway                        http://grogu.test/api/v1/nodejs/public
                                         http://grogu.test/api/v1/golang/public
  Pod status                             make status

  Tunnels/hosts are configured; if URLs stop resolving after sleep,
  just run ./start again (it repairs everything).
  Optional: ./start --metrics (Prometheus + Grafana), ./start --load-generator (HPA test)
EOF
