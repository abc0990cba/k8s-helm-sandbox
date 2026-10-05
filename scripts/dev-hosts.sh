#!/usr/bin/env bash
#
# dev-hosts.sh — put the *.test hostnames for a target into /etc/hosts.
#
# The smoke tests never need them (they use curl --resolve), but a browser
# does: grogu.test / auth.test (+ argocd.test for the UI, prom/grafana.test
# when metrics are on).
#
# Usage:
#   scripts/dev-hosts.sh [target]              # print the block for target
#   scripts/dev-hosts.sh [target] --install    # merge it into /etc/hosts (sudo)
#   scripts/dev-hosts.sh [target] --remove     # drop our lines again
#
# Targets: local (minikube) | orbstack | lan | vps — IP resolved the same way
# ./start does (minikube ip / ansible/inventory.ini, orb CLI as a fallback).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INVENTORY="$REPO_DIR/ansible/inventory.ini"
HOSTNAMES="grogu.test auth.test argocd.test prom.test grafana.test"
MARK="# k8s-helm-sandbox dev hosts"

info() { printf '→ %s\n' "$*"; }
pass() { printf '✔ %s\n' "$*"; }
die()  { printf '✖ %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

TARGET="${1:-orbstack}"
ACTION="${2:---print}"
case "$TARGET" in local|orbstack|lan|vps) ;; *) die "unknown target '$TARGET'";; esac
case "$ACTION" in --print|--install|--remove) ;; *) die "unknown action '$ACTION'";; esac

resolve_ip() {
  case "$TARGET" in
    local)
      have minikube || die "minikube not found"
      minikube ip ;;
    *)
      if [ -f "$INVENTORY" ]; then
        awk -v want="[$TARGET]" '
          $0 == want { ingrp = 1; next }
          /^\[/      { ingrp = 0 }
          ingrp && /ansible_host=/ {
            for (i = 1; i <= NF; i++)
              if ($i ~ /^ansible_host=/) { split($i, a, "="); print a[2]; exit }
          }' "$INVENTORY" && return 0
      fi
      if [ "$TARGET" = orbstack ] && have orb; then
        orb -m k3s-orbstack -u ubuntu hostname -I 2>/dev/null | awk '{print $1}' && return 0
      fi
      die "no IP for target '$TARGET' (no $INVENTORY entry?)" ;;
  esac
}

IP=$(resolve_ip)
[ -n "$IP" ] || die "empty IP for target '$TARGET'"

block="$MARK ($TARGET, $(date +%Y-%m-%d))"
for h in $HOSTNAMES; do block+=$'\n'"$IP $h"; done

if [ "$ACTION" = --print ]; then
  echo "$block"
  exit 0
fi

[ "$(uname)" = Darwin ] || die "only wired for macOS hosts file (the machine running the browser)"
sudo -v || die "need sudo to edit /etc/hosts"
sudo cp /etc/hosts "/etc/hosts.bak.$(date +%s)"

# drop our previous block lines and any stale lines naming these hosts
DEL=(-e "/$MARK/d")
for h in $HOSTNAMES; do DEL+=(-e "/[[:space:]]$h/d"); done
sudo sed -i '' "${DEL[@]}" /etc/hosts

if [ "$ACTION" = --install ]; then
  printf '%s\n' "$block" | sudo tee -a /etc/hosts >/dev/null
  pass "installed: $IP -> $(echo $HOSTNAMES)"
  pass "prior copy kept at /etc/hosts.bak.*"
else
  pass "removed the dev-hosts lines from /etc/hosts"
fi
