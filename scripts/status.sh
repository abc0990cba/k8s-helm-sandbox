#!/usr/bin/env bash
#
# status.sh — what is running right now: cluster, pods, release, tunnel, URLs.
set -euo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

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
