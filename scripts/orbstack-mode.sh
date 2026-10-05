#!/usr/bin/env bash
#
# orbstack-mode.sh — first-class switch between the two GitOps modes of the
# ./start orbstack target:
#
#   local   ArgoCD syncs from an in-machine bare repo (git daemon :9418),
#           CI runs on Gitea Actions, images land in the in-cluster registry.
#           Fully offline / free. (.gitea/workflows/build-deploy.yml runs.)
#   github  ArgoCD syncs from GitHub, CI runs on GitHub Actions, images land
#           on Docker Hub — the shape lan/vps already use.
#           (.github/workflows/build-deploy.yml runs.)
#
# What a switch rewrites (idempotently; one commit when something changes):
#   - moves the workflow file between .gitea/workflows/ and .github/workflows/
#   - the marked MODE/REGISTRY/REPO/runs-on lines inside it
#   - gitops/apps/orbstack/ap.yaml repoURL (what the `ap` Application watches)
#   - ansible/group_vars/orbstack.yml (repo_url override on/off)
#   - helm-chart/values-orbstack.yaml image block — each mode remembers its
#     own last-known images in .local/orbstack-images-<mode>.yaml, so
#     round-tripping local -> github -> local keeps both deploy states.
#
# Usage:
#   scripts/orbstack-mode.sh status          # what mode am I in
#   scripts/orbstack-mode.sh local|github    # switch + commit
#
# After switching:
#   local  -> scripts/orbstack-local-git.sh  (publish main + start the daemon)
#             then ./start orbstack
#   github -> git push origin main; make sure the GH_PAT / DOCKERHUB_USER /
#             DOCKERHUB_TOKEN Actions secrets exist on the GitHub repo.
#
# REPO_DIR env var overrides the repo root (used by tests).
set -euo pipefail

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
WF_LOCAL=".gitea/workflows/build-deploy.yml"
WF_GITHUB=".github/workflows/build-deploy.yml"
AP_YAML="gitops/apps/orbstack/ap.yaml"
GROUP_VARS="ansible/group_vars/orbstack.yml"
VALUES_ORB="helm-chart/values-orbstack.yaml"
VALUES_BASE="helm-chart/values.yaml"
GITEA_SLUG="ci-admin/k8s-helm-sandbox"     # created by scripts/orbstack-gitea.sh
GIT_HOST="host.orb.internal:3000"          # Gitea as seen from job containers
STATE_DIR="$REPO_DIR/.local"

info() { printf '→ %s\n' "$*"; }
pass() { printf '✔ %s\n' "$*"; }
die()  { printf '✖ %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

current_mode() {
  [ -f "$REPO_DIR/$WF_GITHUB" ] && { echo github; return; }
  [ -f "$REPO_DIR/$WF_LOCAL" ]  && { echo local;  return; }
  die "no workflow file at $WF_LOCAL or $WF_GITHUB — where did build-deploy.yml go?"
}

# machine IP: prefer the live OrbStack answer, fall back to what's on disk
resolve_ip() {
  if have orb; then
    local ip
    ip=$(orb -m k3s-orbstack -u ubuntu hostname -I 2>/dev/null | awk '{print $1}')
    [ -n "${ip:-}" ] && { echo "$ip"; return 0; }
  fi
  sed -n 's|^repo_url: "git://\([0-9.]*\):9418.*|\1|p' "$REPO_DIR/$GROUP_VARS"
}

# owner/repo of the GitHub mirror — single source of truth: group_vars/all.yml
github_slug() {
  local slug
  slug=$(sed -n 's|^repo_url: "https://github.com/\([^"]*\)\.git"|\1|p' "$REPO_DIR/ansible/group_vars/all.yml")
  [ -n "$slug" ] || die "could not parse repo_url from ansible/group_vars/all.yml"
  echo "$slug"
}

# Docker Hub namespace, parsed from the base values front image
hub_namespace() {
  local ns
  ns=$(awk '/^front:/{f=1;next} f&&/^  image:/{v=$2; sub(/:[^:]*$/,"",v); split(v,a,"/"); r=a[1]; if (r ~ /[.:]/) r=a[2]; print r; exit}' "$REPO_DIR/$VALUES_BASE")
  [ -n "$ns" ] || die "could not parse the front image namespace from $VALUES_BASE"
  echo "$ns"
}

base_kv() { # $1 = top-level key of values.yaml -> echoes "image version"
  awk -v key="$1" '
    $0 ~ "^"key":" { inb = 1; next }
    inb && /^[^ #]/ { exit }
    inb && /^  image:/   { img = $2 }
    inb && /^  version:/ { ver = $2 }
    END { print img, ver }
  ' "$REPO_DIR/$VALUES_BASE"
}

save_image_block() { # $1 = mode label to save under
  mkdir -p "$STATE_DIR"
  awk '/^front:/ { on = 1 } /^tls:/ { on = 0 } on' "$REPO_DIR/$VALUES_ORB" \
    > "$STATE_DIR/orbstack-images-$1.yaml"
  pass "saved the current image block for mode '$1'"
}

image_block_for() { # $1 = target mode -> echoes the block text
  local saved="$STATE_DIR/orbstack-images-$1.yaml"
  if [ -s "$saved" ]; then cat "$saved"; return; fi
  local f_img f_ver n_img n_ver g_img g_ver
  read -r f_img f_ver <<< "$(base_kv front)"
  read -r n_img n_ver <<< "$(base_kv nodejsBack)"
  read -r g_img g_ver <<< "$(base_kv golangBack)"
  if [ "$1" = github ]; then
    printf 'front:\n  image: %s\n  version: %s\nnodejsBack:\n  image: %s\n  version: %s\ngolangBack:\n  image: %s\n  version: %s\n' \
      "$f_img" "$f_ver" "$n_img" "$n_ver" "$g_img" "$g_ver"
  else
    local ip; ip=$(resolve_ip) || die "need the machine IP for a local-mode image block (is the machine up?)"
    printf 'front:\n  image: %s:30500/grogu-front\n  version: %s\nnodejsBack:\n  image: %s\n  version: %s\ngolangBack:\n  image: %s\n  version: %s\n' \
      "$ip" "$f_ver" "$n_img" "$n_ver" "$g_img" "$g_ver"
  fi
}

splice_image_block() { # $1 = file containing the block to write in
  awk -v blk="$1" '
    /^front:/ { while ((getline line < blk) > 0) print line; skip = 1; next }
    /^tls:/   { skip = 0 }
    skip != 1 { print }
  ' "$REPO_DIR/$VALUES_ORB" > "$REPO_DIR/$VALUES_ORB.tmp" \
    && mv "$REPO_DIR/$VALUES_ORB.tmp" "$REPO_DIR/$VALUES_ORB"
}

switch_mode() { # $1 = target mode
  local target="$1" current ip slug hub
  current=$(current_mode)
  if [ "$target" = "$current" ]; then
    pass "already in $target mode — nothing to do"
    return 0
  fi

  save_image_block "$current"

  # move the workflow file to where the target CI looks for it
  if [ "$target" = github ]; then
    mkdir -p "$REPO_DIR/.github/workflows"
    git -C "$REPO_DIR" mv "$WF_LOCAL" "$WF_GITHUB"
    rmdir "$REPO_DIR/.gitea/workflows" "$REPO_DIR/.gitea" 2>/dev/null || true
  else
    ip=$(resolve_ip) || die "need the machine IP to switch to local mode (is the OrbStack machine up?)"
    mkdir -p "$REPO_DIR/.gitea/workflows"
    git -C "$REPO_DIR" mv "$WF_GITHUB" "$WF_LOCAL"
    rmdir "$REPO_DIR/.github/workflows" "$REPO_DIR/.github" 2>/dev/null || true
  fi

  local wf; [ "$target" = github ] && wf="$WF_GITHUB" || wf="$WF_LOCAL"
  if [ "$target" = github ]; then
    slug=$(github_slug); hub=$(hub_namespace)
    sed -i '' \
      -e "s,^  MODE:.*,  MODE: github,g" \
      -e "s,^  REGISTRY:.*,  REGISTRY: docker.io/$hub,g" \
      -e "s,^  REPO:.*,  REPO: $slug,g" \
      -e "s,^    runs-on: .*,    runs-on: ubuntu-latest,g" \
      "$REPO_DIR/$wf"
  else
    sed -i '' \
      -e "s,^  MODE:.*,  MODE: local,g" \
      -e "s,^  REGISTRY:.*,  REGISTRY: $ip:30500,g" \
      -e "s,^  REPO:.*,  REPO: $GITEA_SLUG,g" \
      -e "s,^    runs-on: .*,    runs-on: docker,g" \
      "$REPO_DIR/$wf"
  fi

  # what the `ap` Application watches
  if [ "$target" = github ]; then
    sed -i '' "s,^    repoURL: .*,    repoURL: $(github_slug_url)," "$REPO_DIR/$AP_YAML"
  else
    sed -i '' "s,^    repoURL: .*,    repoURL: git://$ip:9418/gitops-origin.git," "$REPO_DIR/$AP_YAML"
  fi

  write_group_vars "$target" "${ip:-}"

  # per-mode image memory -> overlay
  image_block_for "$target" > "$STATE_DIR/orbstack-images-$target.yaml.new"
  splice_image_block "$STATE_DIR/orbstack-images-$target.yaml.new"
  mv "$STATE_DIR/orbstack-images-$target.yaml.new" "$STATE_DIR/orbstack-images-$target.yaml"

  git -C "$REPO_DIR" add "$wf" "$AP_YAML" "$GROUP_VARS" "$VALUES_ORB"
  if git -C "$REPO_DIR" diff --cached --quiet; then
    pass "files unchanged — mode switch was a no-op"
  else
    git -C "$REPO_DIR" commit -q -m "orbstack: switch to $target mode (repoURL, registry, CI runner)"
    pass "committed the switch to $target mode"
  fi

  if [ "$target" = github ]; then
    cat <<'EOF'

  Now in GITHUB mode:
    1. git push origin main                     (CI + ArgoCD now follow GitHub)
    2. ensure GitHub Actions secrets exist:     GH_PAT, DOCKERHUB_USER, DOCKERHUB_TOKEN
    3. redeploy loop: git push origin main
  Back to the offline rehearsal:  scripts/orbstack-mode.sh local
EOF
  else
    cat <<'EOF'

  Now in LOCAL mode:
    1. scripts/orbstack-local-git.sh            (publish main + start the git daemon)
    2. ./start orbstack
  Redeploy loop: git add -A && git commit && scripts/orbstack-local-git.sh
  Back to GitHub:  scripts/orbstack-mode.sh github
EOF
  fi
}

github_slug_url() { echo "https://github.com/$(github_slug).git"; }

write_group_vars() { # $1 = mode, $2 = machine ip (local only)
  local repo_line repo_comment
  if [ "$1" = local ]; then
    repo_line="repo_url: \"git://$2:9418/gitops-origin.git\""
    repo_comment='# local-Gitea mode: ArgoCD syncs from the in-machine bare repo served by
# the git daemon (scripts/orbstack-local-git.sh starts it). scripts/orbstack-mode.sh
# manages this override when switching modes.'
  else
    repo_line='# repo_url: "git://<machine-ip>:9418/gitops-origin.git"'
    repo_comment='# local-Gitea mode override is OFF — ArgoCD syncs from the shared GitHub repo
# like lan/vps do. scripts/orbstack-mode.sh local re-enables it.'
  fi
  cat > "$REPO_DIR/$GROUP_VARS" <<EOF
# vars for the orbstack target — local rehearsal of the remote pipeline.
# A real Ubuntu 24.04 machine in OrbStack on this Mac, bootstrapped by the
# same site.yml roles as lan/vps (scripts/orbstack-create.sh makes the machine).
env_name: "orbstack"
tls_enabled: false   # *.test cannot get real certificates; flip to true to
                     # rehearse the vps TLS branch (needs values-orbstack.yaml
                     # with tls.* + sslip.io-style domains)
argocd_domain: "argocd.test"   # add to the Mac's hosts file next to grogu.test if you want the ArgoCD UI

$repo_comment
$repo_line

# the machine's host key isn't in known_hosts until the first connect — accept it
# instead of failing under ansible's BatchMode (orbstack-create.sh also does a
# verified handshake, this is the belt to that suspenders)
ansible_ssh_common_args: "-o StrictHostKeyChecking=accept-new"
EOF
}

show_status() {
  local mode ip
  mode=$(current_mode)
  ip=$(resolve_ip || true)
  echo "mode:        $mode"
  echo "workflow:    $([ "$mode" = github ] && echo "$WF_GITHUB" || echo "$WF_LOCAL")"
  echo "machine IP:  ${ip:-unknown}"
  echo "repoURL:     $(sed -n 's|^    repoURL: ||p' "$REPO_DIR/$AP_YAML")"
  echo "registry:    $(sed -n 's|^  REGISTRY: ||p' "$REPO_DIR/$([ "$mode" = github ] && echo "$WF_GITHUB" || echo "$WF_LOCAL")")"
  echo "images:"
  awk '/^front:/ { on = 1 } /^tls:/ { on = 0 } on { print "  " $0 }' "$REPO_DIR/$VALUES_ORB"
}

case "${1:-}" in
  status) show_status ;;
  local|github) switch_mode "$1" ;;
  *) sed -n '2,40p' "${BASH_SOURCE[0]}"; exit 1 ;;
esac
