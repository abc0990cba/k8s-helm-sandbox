#!/usr/bin/env bash
#
# local-down.sh — tear the stack down.
#   ./stop            helm uninstall + stop the tunnel (cluster stays)
#   ./stop --purge    also delete the whole minikube cluster
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE="ap"
PURGE=false
[ "${1:-}" = "--purge" ] && PURGE=true

step()    { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
pass()    { printf '  ✔ %s\n' "$*"; }
info()    { printf '    %s\n' "$*"; }

step "Uninstalling helm release '$RELEASE'"
if helm status "$RELEASE" >/dev/null 2>&1; then
  helm uninstall "$RELEASE" >/dev/null
  pass "release uninstalled"
else
  info "release not installed — nothing to do"
fi

step "Stopping minikube tunnel"
if pgrep -f "minikube tunnel" >/dev/null 2>&1; then
  sudo -n true 2>/dev/null || { info "sudo password required to stop the tunnel"; sudo -v; }
  sudo -n pkill -f "minikube tunnel" || true
  pass "tunnel stopped"
else
  info "no tunnel running"
fi

if [ "$PURGE" = true ]; then
  step "Deleting the minikube cluster (--purge)"
  minikube delete
  pass "cluster deleted (all data wiped)"
else
  info "minikube cluster kept. Use './stop --purge' to delete it completely."
fi
