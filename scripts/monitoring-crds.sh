#!/usr/bin/env bash
#
# monitoring-crds.sh — (re)apply the kube-prometheus-stack monitoring CRDs
# out-of-band, server-side. The chart deliberately renders them with
# `crds.enabled: false`: ArgoCD's structured-merge diff chokes on the
# multi-megabyte CRD schemas (application goes Unknown with a comparison
# error), so the CRD lifecycle is kept out of the GitOps loop.
#
# Bump the kube-prometheus-stack version in helm-chart/Chart.yaml ⇒ re-run this
# (it reads the CRDs from the vendored subchart, so they always match).
#
# Usage:
#   scripts/monitoring-crds.sh                 # orbstack (default target)
#   TARGET=lan scripts/monitoring-crds.sh      # any remote target via the tunnel
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${TARGET:-orbstack}"

info() { printf '→ %s\n' "$*"; }
die()  { printf '✖ %s\n' "$*" >&2; exit 1; }

CRDS=$(helm template ap "$REPO_DIR/helm-chart" --include-crds \
  --set database.name=x --set database.user=x --set database.password=x \
  --set keycloak.adminName=admin --set keycloak.adminPassword=admin \
  -f "$REPO_DIR/helm-chart/values-orbstack.yaml" 2>/dev/null \
  | python3 -c "
import sys, re, os, tempfile
text = sys.stdin.read()
d = tempfile.mkdtemp(prefix='mon-crds-')
n = 0
for doc in text.split('\n---\n'):
    if 'kind: CustomResourceDefinition' in doc:
        m = re.search(r'^\s{2}name: (\S+)', doc, re.M)
        open(os.path.join(d, (m.group(1) if m else f'crd-{n}') + '.yaml'), 'w').write(doc.strip() + '\n')
        n += 1
if n == 0:
    sys.exit('no CRDs rendered — is the vendored subchart present?')
print(d)")

[ -d "$CRDS" ] || die "could not render the monitoring CRDs"
N=$(ls "$CRDS" | wc -l | tr -d ' ')
info "rendered $N monitoring CRDs"

case "$TARGET" in
  orbstack)
    tar -C "$CRDS" -cf - . | orb -m k3s-orbstack -u ubuntu \
      sh -c 'rm -rf /tmp/mon-crds && mkdir -p /tmp/mon-crds && tar -C /tmp/mon-crds -xf - 2>/dev/null; sudo k3s kubectl apply --server-side -f /tmp/mon-crds/ && sudo k3s kubectl get crd -n default 2>/dev/null | grep -c monitoring.coreos.com' ;;
  *)
    die "for lan/vps: pipe the rendered dir over ssh yourself (kubectl apply --server-side -f)" ;;
esac

pass "monitoring CRDs applied — ArgoCD manages everything else"
