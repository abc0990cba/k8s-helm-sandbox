#!/usr/bin/env bash
#
# orbstack-gitea.sh — local git server + CI runner (the "GitHub twin").
#
# Runs two OrbStack containers on this Mac:
#   gitea         git server + web UI   → http://localhost:3000
#   gitea-runner  Gitea Actions runner  → executes CI jobs as docker containers
#                   (builds/pushes images via the Mac's docker, reaches Gitea
#                    and the in-machine registry without any external service)
#
# Creates: admin user `ci-admin` (password in .local/gitea-credentials.txt),
# an empty repo `k8s-helm-sandbox`, and a registered runner.
#
# Idempotent: safe to re-run. After it succeeds, set your git remote:
#   git remote add gitea http://localhost:3000/ci-admin/k8s-helm-sandbox.git
# and the deploy loop is: edit → commit → git push gitea main
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GITEA_PORT=3000
GITEA_USER="ci-admin"
REPO_NAME="k8s-helm-sandbox"
CRED_FILE="$REPO_DIR/.local/gitea-credentials.txt"
RUNNER_CFG="$HOME/.orbstack-gitea/runner-config.yaml"

info() { printf '→ %s\n' "$*"; }
pass() { printf '✔ %s\n' "$*"; }
die()  { printf '✖ %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

have docker || die "docker not found — start OrbStack"
mkdir -p "$REPO_DIR/.local"

docker network inspect gitea-net >/dev/null 2>&1 || docker network create gitea-net >/dev/null

# ---------------------------------------------------------------- 1. gitea server
if docker ps --format '{{.Names}}' | grep -qx gitea; then
  pass "gitea container already running"
else
  info "starting gitea (web UI will be http://localhost:$GITEA_PORT)"
  docker rm -f gitea >/dev/null 2>&1 || true
  docker run -d --name gitea --restart=always --network gitea-net \
    -p "$GITEA_PORT:3000" \
    -v gitea-data:/data \
    -e "GITEA__server__DOMAIN=localhost" \
    -e "GITEA__server__ROOT_URL=http://localhost:$GITEA_PORT/" \
    -e "GITEA__security__INSTALL_LOCK=true" \
    -e "GITEA__security__SECRET_KEY=$(openssl rand -hex 16)" \
    gitea/gitea:1.24 >/dev/null
fi

info "waiting for gitea to become ready"
for _ in $(seq 1 60); do
  curl -sf "http://localhost:$GITEA_PORT/api/healthz" >/dev/null 2>&1 && break
  sleep 3
done
curl -sf "http://localhost:$GITEA_PORT/api/healthz" >/dev/null || die "gitea did not become ready"
pass "gitea is up"

# ---------------------------------------------------------------- 2. admin user
PASSWORD_FILE="$CRED_FILE"
GITEA_PASS=""
if docker exec -u 1000 gitea gitea --config /data/gitea/conf/app.ini admin user list 2>/dev/null | grep -q "$GITEA_USER"; then
  pass "admin user $GITEA_USER already exists"
  [ -f "$PASSWORD_FILE" ] || die "user exists but $PASSWORD_FILE is missing — cannot continue"
  GITEA_PASS=$(grep '^password:' "$PASSWORD_FILE" | awk '{print $2}')
else
  GITEA_PASS=$(openssl rand -hex 12)
  docker exec -u 1000 gitea gitea --config /data/gitea/conf/app.ini admin user create \
    --admin --username "$GITEA_USER" --password "$GITEA_PASS" \
    --email "ci-admin@example.test" --must-change-password=false >/dev/null
  {
    echo "url:      http://localhost:$GITEA_PORT"
    echo "user:     $GITEA_USER"
    echo "password: $GITEA_PASS"
    echo "repo:     http://localhost:$GITEA_PORT/$GITEA_USER/$REPO_NAME.git"
  } > "$PASSWORD_FILE"
  chmod 600 "$PASSWORD_FILE"
  pass "admin user created — credentials: $PASSWORD_FILE"
fi

# ---------------------------------------------------------------- 3. repo
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' -u "$GITEA_USER:$GITEA_PASS" \
  -X POST "http://localhost:$GITEA_PORT/api/v1/user/repos" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"$REPO_NAME\",\"private\":false,\"auto_init\":false}")
{ [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "409" ]; } \
  || die "repo creation failed (HTTP $HTTP_CODE)"
pass "repo ready: http://localhost:$GITEA_PORT/$GITEA_USER/$REPO_NAME.git"

# ---------------------------------------------------------------- 4. runner
# repo-scoped token: the runner becomes available to this repo automatically
RUNNER_TOKEN=$(curl -sf -u "$GITEA_USER:$GITEA_PASS" \
  "http://localhost:$GITEA_PORT/api/v1/repos/$GITEA_USER/$REPO_NAME/actions/runners/registration-token" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])" 2>/dev/null)
[ -n "$RUNNER_TOKEN" ] || die "could not get the repo runner registration token"

mkdir -p "$(dirname "$RUNNER_CFG")"
cat > "$RUNNER_CFG" <<EOF
# jobs run as docker containers on this Mac; they get the docker socket
# (to build/push images) and resolve Gitea via host.orb.internal
container:
  options: "-v /var/run/docker.sock:/var/run/docker.sock"
EOF

if docker ps --format '{{.Names}}' | grep -qx gitea-runner; then
  info "recreating act_runner with the current registration token"
  docker rm -f gitea-runner >/dev/null 2>&1 || true
else
  info "starting act_runner (jobs run as docker containers via this Mac's docker)"
  docker rm -f gitea-runner >/dev/null 2>&1 || true
  docker run -d --name gitea-runner --restart=always --network gitea-net \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$RUNNER_CFG:/config.yaml:ro" \
    -e "GITEA_INSTANCE_URL=http://gitea:$GITEA_PORT" \
    -e "GITEA_RUNNER_REGISTRATION_TOKEN=$RUNNER_TOKEN" \
    -e "GITEA_RUNNER_NAME=mac-runner" \
    -e "GITEA_RUNNER_LABELS=docker:docker://catthehacker/ubuntu:act-latest" \
    gitea/act_runner:latest >/dev/null
fi

info "waiting for the runner to register to the repo"
for _ in $(seq 1 40); do
  curl -sf -u "$GITEA_USER:$GITEA_PASS" \
    "http://localhost:$GITEA_PORT/api/v1/repos/$GITEA_USER/$REPO_NAME/actions/runners" \
    | grep -q "mac-runner" && break
  sleep 3
done
curl -sf -u "$GITEA_USER:$GITEA_PASS" \
  "http://localhost:$GITEA_PORT/api/v1/repos/$GITEA_USER/$REPO_NAME/actions/runners" \
  | grep -q "mac-runner" \
  || die "runner did not register to the repo — check: docker logs gitea-runner"
pass "runner registered: mac-runner"

cat <<EOF

  Gitea + CI runner are up.

  Git remote for this project:
    git remote remove gitea 2>/dev/null; git remote add gitea \\
      "http://localhost:$GITEA_PORT/$GITEA_USER/$REPO_NAME.git"
  (git will ask for $GITEA_USER / the password from $PASSWORD_FILE —
   or bake them in: http://$GITEA_USER:<password>@localhost:$GITEA_PORT/...)

  Deploy loop from now on:
    git add -A && git commit -m "..." && git push gitea main
EOF
