#!/usr/bin/env bash
#
# remote-up.sh — bring the app up on a remote k3s target (lan|vps).
# Called via ./start <target>; end-to-end it is:
#
#   ansible bootstrap (idempotent)  →  ssh tunnel for the k8s API
#   →  wait for ArgoCD 'ap' Healthy/Synced  →  smoke tests (HTTP + JWT)
#
# Flags:
#   --skip-bootstrap   cluster already provisioned; just wait + smoke
#   --skip-smoke       skip the HTTP checks
#   anything else is passed to ansible-playbook (e.g. -e k=v, --tags k3s)
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=remote-env.sh
source scripts/remote-env.sh

TARGET="${1:-}"
[ -n "$TARGET" ] || die "usage: ./start <lan|vps> [--skip-bootstrap] [--skip-smoke]"
shift || true

SKIP_BOOTSTRAP=false
SKIP_SMOKE=false
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-bootstrap) SKIP_BOOTSTRAP=true ;;
    --skip-smoke) SKIP_SMOKE=true ;;
    *) break ;;   # rest goes to ansible-playbook
  esac
  shift
done

load_target "$TARGET"

have ansible-playbook || die "ansible not found on this Mac:
   brew install ansible
   ansible-galaxy collection install -r ansible/requirements.yml"
have kubectl       || die "kubectl not found — brew install kubectl"

info "target: $TARGET ($R_USER@$R_HOST)"

if [ "$SKIP_BOOTSTRAP" = false ]; then
  info "ansible bootstrap (idempotent — safe to re-run anytime)"
  ansible-playbook -i ansible/inventory.ini ansible/site.yml --limit "$TARGET" "$@"
else
  info "skipping bootstrap (--skip-bootstrap)"
fi

trap close_tunnel EXIT
open_tunnel
kubeconfig_for_target

wait_for_app
app_domains

if [ "$SKIP_SMOKE" = false ]; then
  if run_smoke; then SMOKE_RC=0; else SMOKE_RC=$?; fi
else
  SMOKE_RC=0
  warn "smoke tests skipped (--skip-smoke)"
fi

# ---------------------------------------------------------------- summary
ACD_DOMAIN=$(awk -F': *' '/^argocd_domain:/{gsub(/"/, "", $2); print $2; exit}' \
              "ansible/group_vars/$TARGET.yml" 2>/dev/null || echo "$R_HOST")
ACD_SCHEME="http"; [ "$TARGET" = "vps" ] && ACD_SCHEME="https"

cat <<EOF

  ✔ target '$TARGET' is up

  App (demo / demo)                     $R_SCHEME://$R_APP_HOST/
  API via gateway                       $R_SCHEME://$R_APP_HOST/api/v1/nodejs/public
  Keycloak admin (secrets.yaml creds)   $R_SCHEME://$R_AUTH_HOST/
  ArgoCD UI (admin)                     $ACD_SCHEME://$ACD_DOMAIN/
     password: cat .local/argocd-$TARGET-admin-pw

  Redeploys from now on:                git push   (ArgoCD auto-syncs)
  Full status:                          bash scripts/status.sh $TARGET
EOF

[ "$SMOKE_RC" -eq 0 ] || die "some smoke checks failed — see the warnings above"
pass "all smoke checks passed"
