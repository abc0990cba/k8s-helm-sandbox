#!/usr/bin/env bash
#
# status.sh — what is running right now: cluster, pods, release, tunnel, URLs.
#   scripts/status.sh          → local minikube
#   scripts/status.sh lan|vps  → remote target (short-lived ssh tunnel, no hosts edits)
set -euo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

TARGET="${1:-local}"

if [ "$TARGET" != "local" ]; then
  # shellcheck source=remote-env.sh
  source "$REPO_DIR/scripts/remote-env.sh"
  load_target "$TARGET"
  have kubectl || { echo "kubectl not found — brew install kubectl"; exit 1; }
  trap close_tunnel EXIT
  open_tunnel
  kubeconfig_for_target
  app_domains
  port=80; [ "$R_SCHEME" = "https" ] && port=443

  echo "── $TARGET ($R_HOST) ──────────────────────"
  kubectl get nodes -o wide 2>/dev/null || echo "cannot reach cluster"

  echo; echo "── pods ─────────────────────────────────"
  kubectl get pods 2>/dev/null || true

  echo; echo "── argocd app ───────────────────────────"
  kubectl -n argocd get applications.argoproj.io 2>/dev/null || true

  echo; echo "── ingress / certs ──────────────────────"
  kubectl get ingress 2>/dev/null || true
  kubectl -n default get certificate 2>/dev/null || true

  echo; echo "── URLs (--resolve, hosts files not needed) ──"
  for name_host_path in "app      $R_APP_HOST  /" "gateway  $R_APP_HOST  /api/healthz" "keycloak $R_AUTH_HOST /realms/demorealm"; do
    name=${name_host_path%% *}
    rest=${name_host_path#* }
    host=${rest%% *}
    path=${rest#* }
    url="$R_SCHEME://$host$path"
    code=$(curl -sk --max-time 3 --resolve "$host:$port:$R_HOST" -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || true)
    [ -z "$code" ] && code=000
    printf '  %s  %s  → HTTP %s\n' "$name" "$url" "$code"
  done
  exit 0
fi

if have kubectl; then K() { kubectl "$@"; }; else K() { minikube kubectl -- "$@"; }; fi

echo "── minikube ─────────────────────────────"
minikube status 2>/dev/null || echo "cluster not running"

echo; echo "── pods ─────────────────────────────────"
K get pods 2>/dev/null || echo "cannot reach cluster"

echo; echo "── helm release ─────────────────────────"
helm status ap 2>/dev/null | head -6 || echo "release 'ap' not installed"

echo; echo "── ingress ──────────────────────────────"
K get ingress 2>/dev/null || true

echo; echo "── tunnel ───────────────────────────────"
if pgrep -f "minikube tunnel" >/dev/null 2>&1; then
  echo "running (pid $(pgrep -f 'minikube tunnel' | head -1))"
else
  echo "NOT running — run ./start to restore it"
fi

echo; echo "── URLs ─────────────────────────────────"
for name_url in "app      http://grogu.test/" "gateway  http://grogu.test/api/healthz" "keycloak http://auth.test/"; do
  name="${name_url%% *}"; url="${name_url#* }"
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$url" 2>/dev/null || true)
  [ -z "$code" ] && code=000
  printf '  %s  %s  → HTTP %s\n' "$name" "$url" "$code"
done
