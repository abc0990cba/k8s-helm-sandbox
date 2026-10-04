#!/usr/bin/env bash
#
# orbstack-create.sh — provision the local "remote" machine in OrbStack.
#
# One command that prepares everything `./start orbstack` needs:
#   1. an Ubuntu 24.04 machine (same distro as the lan/vps targets) with
#      4 CPUs / 8 GB RAM — the same shape as the VirtualBox/VPS sizing;
#   2. sshd inside it + your Mac's public key, so ansible can take over;
#   3. the [orbstack] group in ansible/inventory.ini (created from the
#      sample if needed, updated in place if it exists).
#
# Idempotent: safe to re-run at any time; it repairs/resumes instead of failing.
#
# The deploy itself is then identical to lan/vps:  ./start orbstack
# (ansible bootstrap → k3s → ingress-nginx → ArgoCD from git → smoke tests).
# See docs/RUN.md, section "OrbStack".
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MACHINE="k3s-orbstack"
USER_NAME="ubuntu"
CPUS="4"
MEMORY="8G"
INV="$REPO_DIR/ansible/inventory.ini"
SAMPLE="$REPO_DIR/ansible/inventory.sample.ini"

info() { printf '→ %s\n' "$*"; }
pass() { printf '✔ %s\n' "$*"; }
die()  { printf '✖ %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- preflight
have() { command -v "$1" >/dev/null 2>&1; }
have orb || die "OrbStack not found — install with: brew install orbstack (then start OrbStack.app once)"
orb version >/dev/null 2>&1 || die "OrbStack is installed but not responding — start OrbStack.app and re-run"

PUBKEY="${ADMIN_PUBKEY:-$HOME/.ssh/id_ed25519.pub}"
[ -f "$PUBKEY" ] || die "$PUBKEY not found — generate one (ssh-keygen -t ed25519) or set ADMIN_PUBKEY=/path/to/key.pub"

# ---------------------------------------------------------------- machine
if orbctl list -q | grep -qx "$MACHINE"; then
  pass "machine '$MACHINE' already exists"
else
  info "creating machine '$MACHINE' (ubuntu:24.04, ${CPUS} cpus, ${MEMORY}) — first run downloads the image"
  orb create --cpus "$CPUS" --memory "$MEMORY" -u "$USER_NAME" ubuntu:24.04 "$MACHINE"
  pass "machine created"
fi

orbrun() { orb -m "$MACHINE" -u "$USER_NAME" "$@"; }

# ---------------------------------------------------------------- sshd + key
# OrbStack machines have no sshd running by default; ansible needs one.
if orbrun systemctl is-active --quiet ssh 2>/dev/null; then
  pass "sshd already running"
else
  info "installing/starting sshd inside the machine"
  orbrun sudo apt-get update -qq
  orbrun sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openssh-server
  orbrun sudo systemctl enable --now ssh
  pass "sshd up"
fi

info "installing the admin public key for '$USER_NAME'"
HOME_IN_VM="/home/$USER_NAME"
orbrun sh -c 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'
# NOTE: no `~` in plain orbrun arguments — it would expand on the Mac, not in the machine
KEY=$(cat "$PUBKEY")
if orbrun grep -qxF "$KEY" "$HOME_IN_VM/.ssh/authorized_keys" 2>/dev/null; then
  pass "key already installed"
else
  orbrun tee -a "$HOME_IN_VM/.ssh/authorized_keys" > /dev/null < "$PUBKEY"
  pass "key installed: $PUBKEY"
fi
KEYLINES=$(orbrun wc -l "$HOME_IN_VM/.ssh/authorized_keys" | awk '{print $1}')
[ "${KEYLINES:-0}" -ge 1 ] || die "authorized_keys still empty — the key did not land in the machine"

# ---------------------------------------------------------------- inventory
VM_IP=$(orbrun hostname -I | awk '{print $1}')
[ -n "$VM_IP" ] || die "could not read the machine IP"
pass "machine IP: $VM_IP"

info "verifying key-based SSH from this Mac (the same path ansible will use)"
ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new \
    "$USER_NAME@$VM_IP" 'echo -n' \
  || die "ssh $USER_NAME@$VM_IP failed — the key above didn't get accepted"
pass "ssh $USER_NAME@$VM_IP works"

[ -f "$INV" ] || { info "creating $INV from the committed sample"; cp "$SAMPLE" "$INV"; }

# write/update the [orbstack] group in place (idempotent)
python3 - "$INV" "$MACHINE" "$USER_NAME" "$VM_IP" <<'PYEOF'
import re, sys
inv, machine, user, ip = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
text = open(inv).read()
entry = f"{machine} ansible_host={ip} ansible_user={user}"
group = f"[orbstack]\n# local OrbStack machine on this Mac (scripts/orbstack-create.sh manages this block)\n{entry}\n"
pattern = re.compile(r"\[orbstack\]\n(?:#[^\n]*\n)*[^\[\n]*ansible_host=[^\n]*\n", re.M)
if pattern.search(text):
    text = pattern.sub(group, text)
else:
    if not text.endswith("\n"):
        text += "\n"
    text += "\n" + group
open(inv, "w").write(text)
print("inventory updated")
PYEOF
pass "inventory: [orbstack] → $USER_NAME@$VM_IP"

# ---------------------------------------------------------------- next steps
cat <<EOF

  Machine '$MACHINE' is ready.

  Next:
    ./start orbstack        # ansible bootstrap → k3s → ingress-nginx → ArgoCD → smoke tests
    make status TARGET=orbstack
    ./stop orbstack         # delete ArgoCD apps (--purge also k3s-uninstall)

  Full machine removal (when you want the disk space back):
    orb delete $MACHINE     # then remove the [orbstack] block from $INV
EOF
