#!/usr/bin/env bash
#
# remote-down.sh — tear the app down on a remote target (lan|vps).
# Called via ./stop <target>.
#
#   ./stop lan|vps           delete ArgoCD apps (cascades to all app resources)
#   ./stop lan|vps --purge   also k3s-uninstall the whole cluster
#
# Notes:
#   - Postgres data lives at /data/postgresql on the target host and SURVIVES
#     both modes (recreate the release and it's picked up again).
#   - ArgoCD itself stays installed unless --purge.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=remote-env.sh
source scripts/remote-env.sh

TARGET="${1:-}"
[ -n "$TARGET" ] || die "usage: ./stop <lan|vps> [--purge]"
shift || true

PURGE=false
[ "${1:-}" = "--purge" ] && PURGE=true

load_target "$TARGET"
have kubectl || die "kubectl not found — brew install kubectl"

trap close_tunnel EXIT
open_tunnel
kubeconfig_for_target

info "deleting ArgoCD applications (finalizers cascade-deletes all app resources)"
kubectl -n argocd delete application root --ignore-not-found --wait=true
kubectl -n argocd delete application ap   --ignore-not-found --wait=true
pass "app resources removed"

if [ "$PURGE" = true ]; then
  info "--purge: removing k3s from $R_HOST"
  ssh "$R_USER@$R_HOST" 'sudo /usr/local/bin/k3s-uninstall.sh' \
    || ssh "$R_USER@$R_HOST" 'sudo /usr/local/bin/k3s-killall.sh || true'
  rm -f ".local/kubeconfig-$R_NAME.raw.yaml" ".local/kubeconfig-$R_NAME.yaml"
  pass "cluster removed"
  warn "Postgres data still on the host: /data/postgresql (delete manually if you mean it)"
else
  info "cluster + ArgoCD left running (redeploy: ./start $TARGET, wipe cluster: ./stop $TARGET --purge)"
fi
