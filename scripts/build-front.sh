#!/usr/bin/env bash
#
# build-front.sh — rebuild the react-front image with the auth URLs baked in.
#
# The SPA reads VITE_* at BUILD time (Vite), so a deployment whose app/auth
# hosts differ from grogu.test/auth.test needs its own image — otherwise
# Keycloak logins fail (API endpoints keep working). Run once per environment:
#
#   scripts/build-front.sh <tag> [values-file]
#   scripts/build-front.sh 0.4.0                             # for the VPS overlay
#   scripts/build-front.sh 0.4.1 helm-chart/values-lan.yaml
#
# After it pushes: set front.version: <tag> in that values file, commit, push
# (ArgoCD syncs it), or `helm secrets upgrade` locally for minikube.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAG="${1:?usage: scripts/build-front.sh <tag> [values-file]  e.g. 0.4.0}"
VF="${2:-$REPO_DIR/helm-chart/values-vps.yaml}"
IMAGE="${DOCKER_REPO:-mmko67/grogu-front}"

scheme=$(awk '/^host:/{f=1; next} f && /^  scheme:/{print $2; exit}' "$VF")
app=$(awk   '/^host:/{f=1; next} f && /^  app:/{print $2; exit}'   "$VF")
auth=$(awk  '/^host:/{f=1; next} f && /^  auth:/{print $2; exit}'  "$VF")
[ -n "$app" ] && [ -n "$auth" ] || { echo "✖ could not read host.app/host.auth from $VF" >&2; exit 1; }
scheme=${scheme:-http}

echo "→ building $IMAGE:$TAG with VITE_KEYCLOAK_URL=$scheme://$auth/ VITE_REDIRECT_URL=$scheme://$app/"
docker build \
  --build-arg "VITE_KEYCLOAK_URL=$scheme://$auth/" \
  --build-arg "VITE_KEYCLOAK_REALM=demorealm" \
  --build-arg "VITE_KEYCLOAK_CLIENT=reactclient" \
  --build-arg "VITE_REDIRECT_URL=$scheme://$app/" \
  -t "$IMAGE:$TAG" "$REPO_DIR/react-front"

echo "→ pushing $IMAGE:$TAG"
docker push "$IMAGE:$TAG"

cat <<EOF

  ✔ pushed $IMAGE:$TAG

  Next:
    1. set in $VF:
         front:
           version: "$TAG"
    2. commit + git push   (ArgoCD syncs) — or helm upgrade for minikube
EOF
