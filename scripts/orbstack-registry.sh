#!/usr/bin/env bash
#
# orbstack-registry.sh — in-cluster container registry for the orbstack target.
#
# Deploys `registry:2` as a workload inside the k3s machine (NodePort 30500),
# configures k3s (registries.yaml) to treat it as an insecure mirror, and
# configures the Mac's docker (OrbStack) to allow pushing to it over http.
# After this, CI can `docker push 192.168.139.195:30500/<image>:<tag>` and
# k3s can pull the same reference — the local twin of Docker Hub.
#
# Idempotent: safe to re-run at any time (also re-runs after a machine IP
# change — call it again, it rewrites registries.yaml for the new IP).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MACHINE="k3s-orbstack"
MACHINE_USER="ubuntu"
NODEPORT=30500

info() { printf '→ %s\n' "$*"; }
pass() { printf '✔ %s\n' "$*"; }
die()  { printf '✖ %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

have orb || die "OrbStack not found — brew install orbstack"

VM_IP=$(orb -m "$MACHINE" -u "$MACHINE_USER" hostname -I | awk '{print $1}')
[ -n "$VM_IP" ] || die "could not read the machine IP"
pass "machine IP: $VM_IP"
REGISTRY="$VM_IP:$NODEPORT"

# ---------------------------------------------------------------- 1. registry workload
info "deploying registry:2 into the cluster (namespace registry, NodePort $NODEPORT)"
orb -m "$MACHINE" -u "$MACHINE_USER" sudo k3s kubectl create namespace registry --dry-run=client -o yaml | \
  orb -m "$MACHINE" -u "$MACHINE_USER" sudo k3s kubectl apply -f - >/dev/null

orb -m "$MACHINE" -u "$MACHINE_USER" sudo k3s kubectl -n registry apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: registry
  namespace: registry
spec:
  replicas: 1
  selector:
    matchLabels:
      app: registry
  template:
    metadata:
      labels:
        app: registry
    spec:
      containers:
        - name: registry
          image: registry:2
          ports:
            - containerPort: 5000
          volumeMounts:
            - name: data
              mountPath: /var/lib/registry
      volumes:
        - name: data
          emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: registry
  namespace: registry
spec:
  type: NodePort
  selector:
    app: registry
  ports:
    - port: 5000
      nodePort: $NODEPORT
EOF

info "waiting for the registry pod"
orb -m "$MACHINE" -u "$MACHINE_USER" sudo k3s kubectl -n registry rollout status deployment/registry --timeout=300s >/dev/null \
  || die "registry deployment did not roll out"
pass "registry is running"

# ---------------------------------------------------------------- 2. k3s side (pull)
# containerd must be told that <ip>:30500 speaks plain http
info "configuring k3s registries.yaml (insecure mirror for $REGISTRY)"
orb -m "$MACHINE" -u "$MACHINE_USER" sudo tee /etc/rancher/k3s/registries.yaml >/dev/null <<EOF
mirrors:
  "$REGISTRY":
    endpoint:
      - "http://$REGISTRY"
EOF
orb -m "$MACHINE" -u "$MACHINE_USER" sudo systemctl restart k3s
pass "k3s restarted with the registry mirror"

orb -m "$MACHINE" -u "$MACHINE_USER" sudo k3s kubectl -n registry rollout status deployment/registry --timeout=300s >/dev/null \
  || die "registry did not come back after k3s restart"

# ---------------------------------------------------------------- 3. Mac side (push)
# OrbStack's docker needs the http registry in its insecure-registries list.
# Editing ~/.orbstack/config/docker.json requires restarting the OrbStack app
# once (machines and the cluster come back on their own).
if ! grep -q "\"$REGISTRY\"" ~/.orbstack/config/docker.json 2>/dev/null; then
  info "adding $REGISTRY to OrbStack docker insecure-registries (restarts OrbStack once)"
  python3 - "$REGISTRY" <<'PY'
import json, os, sys
p = os.path.expanduser("~/.orbstack/config/docker.json")
cfg = {}
if os.path.exists(p):
    try:
        cfg = json.load(open(p))
    except Exception:
        cfg = {}
lst = cfg.setdefault("insecure-registries", [])
if sys.argv[1] not in lst:
    lst.append(sys.argv[1])
json.dump(cfg, open(p, "w"), indent=2)
PY
  osascript -e 'quit app "OrbStack"' >/dev/null 2>&1 || true
  sleep 5
  open -a OrbStack
  info "waiting for OrbStack, the machine and k3s to come back"
  for _ in $(seq 1 60); do
    VM_IP_NOW=$(orb -m "$MACHINE" -u "$MACHINE_USER" hostname -I 2>/dev/null | awk '{print $1}')
    [ -n "$VM_IP_NOW" ] && break
    sleep 5
  done
  [ -n "$VM_IP_NOW" ] || die "machine did not come back after the OrbStack restart"
  for _ in $(seq 1 60); do
    [ "$(orb -m "$MACHINE" -u "$MACHINE_USER" sudo systemctl is-active k3s 2>/dev/null)" = "active" ] && break
    sleep 5
  done
fi
# (no `grep -q` here: with pipefail, its early exit SIGPIPEs `docker info`
#  into a non-zero exit and the check would fail even on success)
docker info 2>/dev/null | grep "$REGISTRY" >/dev/null \
  || die "docker on the Mac still refuses $REGISTRY — restart OrbStack.app manually and re-run"
pass "docker on the Mac can push to $REGISTRY"

# ---------------------------------------------------------------- 4. verify
info "verifying push/pull round-trip"
docker pull registry:2 >/dev/null 2>&1 || true
docker tag registry:2 "$REGISTRY/registry-selftest:ok"
docker push -q "$REGISTRY/registry-selftest:ok" >/dev/null 2>&1 \
  || die "docker push to $REGISTRY failed — check the insecure-registries config"
curl -s "http://$REGISTRY/v2/_catalog" | grep -q registry-selftest \
  || die "the registry does not list the pushed image"
pass "push to $REGISTRY works, catalog lists it"

cat <<EOF

  Registry is up:  $REGISTRY  (images: http://$REGISTRY/v2/_catalog)

  Images for this project are referenced as:
    $REGISTRY/grogu-front:<tag>
    $REGISTRY/grogu-api:<tag>
    $REGISTRY/golang-back:<tag>

  k3s pulls them through the mirror configured above — nothing manual.
EOF
