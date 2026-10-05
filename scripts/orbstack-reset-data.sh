#!/usr/bin/env bash
#
# orbstack-reset-data.sh — wipe the stateful demo data inside the k3s-orbstack
# machine. Needed once after a major data-service bump (postgres 14→17,
# redis 4→7): on-disk formats are not backwards compatible. Everything reseeds
# automatically afterwards (the migration Job re-runs on the empty database).
#
# The StatefulSets/Job are recreated by ArgoCD self-heal (~3 min) or immediately
# by ./start orbstack.
set -euo pipefail

MACHINE="k3s-orbstack"
MACHINE_USER="ubuntu"

info() { printf '→ %s\n' "$*"; }
pass() { printf '✔ %s\n' "$*"; }
die()  { printf '✖ %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

have orb || die "OrbStack not found"
ORB="orb -m $MACHINE -u $MACHINE_USER"

info "deleting the postgres + redis StatefulSets (pods go away, ArgoCD recreates them)"
$ORB sudo k3s kubectl -n default delete statefulset postgres-statefulset redis-cache --wait --ignore-not-found

info "wiping postgres data (/data/postgresql on the machine)"
$ORB sudo sh -c 'rm -rf /data/postgresql && mkdir -p /data/postgresql'

info "wiping the redis local-path volume"
$ORB sudo sh -c 'rm -rf /var/lib/rancher/k3s/storage/*redis-persistent-storage*'

info "deleting completed migration Job(s) so they re-run and reseed"
$ORB sudo sh -c 'k3s kubectl -n default get jobs -o name | grep postgres-migration | xargs -r k3s kubectl -n default delete --wait'

pass "data wiped — run ./start orbstack to redeploy and reseed"
