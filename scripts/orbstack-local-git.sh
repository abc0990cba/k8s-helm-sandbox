#!/usr/bin/env bash
#
# orbstack-local-git.sh — GitHub-free GitOps rehearsal for ./start orbstack.
#
# ArgoCD normally syncs the chart from GitHub. While rehearsing locally you may
# not want to push every experiment — this script points the whole pipeline at
# a local bare repo instead:
#
#   Mac working repo --git push--> .local/gitops-origin.git (bare, gitignored)
#                                     ^ served by `git daemon` INSIDE the
#                                       k3s-orbstack machine via OrbStack's
#                                       /mnt/mac filesystem mount (fast:
#                                       the repo never crosses the network)
#   ArgoCD clones git://192.168.139.195:9418/gitops-origin.git
#
# Requires the one-time TEMPORARY repoURL overrides (already committed on this
# branch): ansible/group_vars/orbstack.yml repo_url + gitops/apps/orbstack/ap.yaml.
#
# Usage:
#   ./scripts/orbstack-local-git.sh            # sync local main -> local remote
#   Then: ArgoCD picks it up within ~3 minutes, or run ./start orbstack to force.
#
# Switch back to GitHub:
#   comment out repo_url in ansible/group_vars/orbstack.yml,
#   git revert the two "TEMPORARY" commits, push to origin.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MACHINE="k3s-orbstack"
MACHINE_USER="ubuntu"
BARE="$REPO_DIR/.local/gitops-origin.git"

info() { printf '→ %s\n' "$*"; }
pass() { printf '✔ %s\n' "$*"; }
die()  { printf '✖ %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

have orb || die "OrbStack not found — brew install orbstack"
[ -d "$BARE" ] || { info "creating bare repo"; git clone --bare -q "$REPO_DIR" "$BARE"; }

BRANCH=$(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD)
[ "$BRANCH" = "main" ] || die "on branch '$BRANCH' — ArgoCD tracks main; switch to main first"

# OrbStack can reassign the machine IP — keep inventory + ArgoCD URLs in sync
VM_IP=$(orb -m "$MACHINE" -u "$MACHINE_USER" hostname -I | awk '{print $1}')
[ -n "$VM_IP" ] || die "could not read the machine IP"
OLD_IP=$(grep -oE 'git://[0-9.]+' "$REPO_DIR/ansible/group_vars/orbstack.yml" | cut -d/ -f3)
if [ -n "$OLD_IP" ] && [ "$OLD_IP" != "$VM_IP" ]; then
  info "machine IP changed ($OLD_IP -> $VM_IP) — updating inventory and ArgoCD URLs"
  sed -i '' "s/ansible_host=$OLD_IP/ansible_host=$VM_IP/" "$REPO_DIR/ansible/inventory.ini"
  sed -i '' "s|git://$OLD_IP/|git://$VM_IP/|" \
    "$REPO_DIR/ansible/group_vars/orbstack.yml" "$REPO_DIR/gitops/apps/orbstack/ap.yaml"
  git -C "$REPO_DIR" add ansible/inventory.ini ansible/group_vars/orbstack.yml gitops/apps/orbstack/ap.yaml
  git -C "$REPO_DIR" commit -q -m "TEMPORARY local remote: machine IP moved to $VM_IP (auto)"
fi
pass "machine IP: $VM_IP"

info "pushing local main -> local remote"
git -C "$REPO_DIR" push -q "$BARE" main
pass "$(git --git-dir="$BARE" log --oneline -1)"

info "ensuring the in-machine git daemon (serves $BARE via /mnt/mac)"
# the machine sees the Mac's filesystem at /mnt/mac — pass the repo mount path through
orb -m "$MACHINE" -u "$MACHINE_USER" sudo REPO_MOUNT="/mnt/mac$REPO_DIR/.local" sh -c '
  mkdir -p /srv
  ln -sfn "$REPO_MOUNT/gitops-origin.git" /srv/gitops-origin.git
  [ -f /etc/systemd/system/gitops-git-daemon.service ] || cat > /etc/systemd/system/gitops-git-daemon.service <<UNIT
[Unit]
Description=Local GitOps rehearsal git daemon (serves the Mac bare repo via /mnt/mac)
After=network.target

[Service]
ExecStart=/usr/bin/git daemon --reuseaddr --export-all --base-path=/srv --port=9418
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable --now gitops-git-daemon >/dev/null 2>&1 || systemctl restart gitops-git-daemon
  ufw allow 9418/tcp >/dev/null 2>&1 || true
  systemctl is-active gitops-git-daemon
' >/dev/null
pass "git daemon active in the machine"

URL="git://$VM_IP:9418/gitops-origin.git"
orb -m "$MACHINE" -u "$MACHINE_USER" git ls-remote "$URL" main >/dev/null 2>&1 \
  || die "the remote is not reachable from the machine — check the daemon"
pass "remote reachable: $URL"

cat <<EOF

  Local remote is up to date with local main.

  ArgoCD auto-syncs within ~3 minutes, or force it:
    ./start orbstack

  Your commit → deploy loop while in this mode:
    git add -A && git commit -m "..." && ./scripts/orbstack-local-git.sh

  Back to GitHub when ready:
    1. comment out repo_url in ansible/group_vars/orbstack.yml
    2. git revert the two commits marked TEMPORARY
    3. git push origin main
EOF
