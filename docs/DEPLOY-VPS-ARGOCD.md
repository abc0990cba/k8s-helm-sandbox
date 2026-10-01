# Deploy to a VPS with Ansible + ArgoCD (`./start vps`)

One command brings the whole stack up on a rented Linux box: hardened OS →
single-node k3s → ingress-nginx → cert-manager → **ArgoCD, which then deploys
the app chart straight from this git repository**. From the second deploy on,
`git push` is all it takes.

```
MacBook  ─── ./start vps ───► ansible over ssh (bootstrap, idempotent)
   │                             ├─ common         ufw 22/80/443, fail2ban, unattended-upgrades, swap off, deploy user
   │                             ├─ k3s            single node, --disable traefik
   │                             ├─ ingress_nginx  ServiceLB binds :80/:443 on the VPS
   │                             ├─ cert_manager   for Let's Encrypt
   │                             └─ argocd         ArgoCD + helm-secrets plugin + root app + admin password
   │
   └─ (afterwards) ArgoCD in-cluster watches github.com/abc0990cba/k8s-helm-sandbox
                     └─ gitops/apps/vps/ap.yaml → helm-secrets template helm-chart
                          -f ../secrets.yaml -f values-vps.yaml   → the whole stack
```

`./start lan` runs the **identical flow** against the VirtualBox VM (no TLS,
`*.test` names) — provisioning that VM is covered in
[DEPLOY-LAN-VIRTUALBOX.md](./DEPLOY-LAN-VIRTUALBOX.md). Everything below is the
VPS-specific layer: internet-facing addressing, TLS, hardening, and Day-2.

---

## 1. Prerequisites

**The VPS** — any provider (Hetzner, DigitalOcean, Vultr, Timeweb, …):

| | |
|---|---|
| OS | Ubuntu 24.04 LTS |
| Size | **4 vCPU / 8 GB RAM / 60–80 GB disk** (the app stack requests ~5 Gi; ArgoCD adds ~0.5 Gi) |
| Cost | ~$10–25/month |
| Access | root SSH key configured at provider signup (paste your `~/.ssh/id_ed25519.pub`) |

**The MacBook** (everything is needed only on the Mac):

```bash
kubectl version --client            # brew install kubectl
helm version                        # brew install helm
helm plugin list | grep secrets     # helm-secrets (already there if ./start works)
ansible-playbook --version          # brew install ansible
ansible-galaxy collection install -r ansible/requirements.yml   # community.general (ufw module)
```

## 2. Pick your addressing (decides DNS + TLS)

| Option | TLS | Needs | Notes |
|---|---|---|---|
| **Real domain** (recommended) | Let's Encrypt, automatic | A records for 3–5 hosts (~$2–10/yr domain) | production-shaped |
| **sslip.io** | Let's Encrypt, automatic | nothing — `grogu.1-2-3-4.sslip.io` resolves to `1.2.3.4` | zero-cost, ugly URLs; LE rate-limits per root domain, so expect throttling if the world reuses it |
| **Keep `*.test` + hosts files** | **none** (reserved TLD can't get certs) | hosts entries on every machine you browse from | fastest; fine for a private demo, no mobile/no strangers |

Set the winners in two places:

- `helm-chart/values-vps.yaml` — `host.app/auth/(prometheus/grafana)`,
  `host.scheme: https`, `tls.email:` (Let's Encrypt account mail; the chart
  **refuses to render TLS without it**), and the commented `sslip` examples.
- `ansible/group_vars/vps.yml` — `argocd_domain` (UI host), optionally
  `backup_rclone_remote` (offsite backups, see §7).

With a real domain: create **A records → VPS IP** for every host you set.
Do it before the first deploy — cert-manager issues via HTTP-01 during it.

## 3. First deploy, step by step

```bash
# 1. register the machine as a deploy target
cp ansible/inventory.sample.ini ansible/inventory.ini    # gitignored
$EDITOR ansible/inventory.ini        # [vps] ansible_host=<real IP> ansible_user=root

# 2. point the chart at your domains
$EDITOR helm-chart/values-vps.yaml   # hosts + tls.email (TODOs marked)

# 3. only if your app host is NOT grogu.test: rebuild the SPA image once,
#    then uncomment front.version in values-vps.yaml (why: the script's header)
scripts/build-front.sh 0.4.0

# 4. go
./start vps
```

What `./start vps` does, in order (total ~8–15 min, first deploy longer on
image pulls):

1. **Ansible** (`ansible/site.yml --limit vps`, idempotent — re-running is
   always safe): hardening → k3s → ingress-nginx → cert-manager → ArgoCD.
   The `common` role installs your SSH key for a new `deploy` user *before*
   disabling password SSH — no lockout. Afterwards switch
   `ansible_user=deploy` in `inventory.ini` (root keeps working via key).
2. **SSH tunnel** for the k8s API (`127.0.0.1:16443 → vps:6443`) — port 6443
   itself is firewalled and never exposed.
3. **ArgoCD** applies the root app → the `ap` Application renders the chart
   with `helm secrets` (SOPS decrypted inside the cluster) and syncs. The
   script waits for `Healthy/Synced` (up to ~25 min on first pull).
4. **Smoke tests** mirror `./start`'s suite — all 6 public endpoints + the
   `demo/demo` JWT flow through the gateway — using `--resolve`, so they pass
   even if your local hosts file is untouched.
5. **Summary** prints your URLs + the ArgoCD admin password location:
   `.local/argocd-vps-admin-pw` (generated once by Ansible, bcrypt-set in-cluster).

## 4. Certificates

- Issuer: `letsencrypt-prod` (ClusterIssuer rendered by the chart, HTTP-01 via
  ingress-nginx). Renewals are automatic.
- Check: `kubectl -n default get certificate` → `READY=True` (ArgoCD UI →
  `ap` → `ap-ingress-tls` shows events too).
- Rate-limited or debugging? Point `tls.clusterIssuer` at
  `letsencrypt-staging` — add a second ClusterIssuer in
  `helm-chart/templates/cert-issuer.yaml` (server URL inside, commented).

## 5. Day-2

| Task | How |
|---|---|
| **Chart/values change** | commit → `git push` → ArgoCD auto-syncs (~3 min). `./start vps` also works (skips straight to wait+smoke). |
| **Image bump (node/go)** | `docker build -t mmko67/grogu-api:0.1.7 nodejs-back && docker push …` → bump `version:` in `values.yaml` → push. |
| **Image bump (react)** | `scripts/build-front.sh <tag>` → set `front.version` → push. (VITE_* is baked into the image.) |
| **Secrets change** | `make secrets-edit` → commit (SOPS re-encrypts) → push. **Caveat:** pods read env-secrets at boot — `kubectl -n default rollout restart deploy,statefulset` once the app shows Synced. |
| **Migration SQL change** | also bump `postgres.migration.version` in `values.yaml` — the Job is immutable. |
| **Keycloak realm change** | `config/realm-export.json` imports **only into an empty DB**. Wipe = delete app + `ssh root@vps 'sudo rm -rf /data/postgresql'` + redeploy (loses seeded data; migration re-creates it). |
| **ArgoCD UI** | `https://<argocd_domain>` — admin / `cat .local/argocd-vps-admin-pw`. Diffs, sync history, rollback. Practices: [gitops/README.md](../gitops/README.md). |
| **Component upgrades** | bump the pinned versions in `ansible/group_vars/all.yml` → `./start vps`. k3s follows its `stable` channel. |

## 6. Backups and recovery

The chart's `pg_dumpall` CronJob already writes dated dumps daily — but onto
the **same 1 Gi PVC as the database**. For a VPS, ship them off-box:

```bash
# one-time on the VPS: configure an rclone remote (B2/S3 — both have free tiers)
ssh root@<vps> rclone config
# enable the hourly shipper:
ansible-playbook -i ansible/inventory.ini ansible/site.yml --limit vps --tags backups \
  -e backup_rclone_remote=b2:my-bucket
```

Recovery story (pet-scale, honest): the cluster is disposable — this playbook
rebuilds it in ~10 minutes. What matters is the data: recreate the release,
then restore the newest dump from the bucket with
`psql` into the postgres pod.

## 7. Cost

| Item | Cost |
|---|---|
| VPS 4 vCPU / 8 GB | ~$10–25/mo |
| Domain | ~$2–10/yr (or $0 with sslip.io) |
| Let's Encrypt, ArgoCD, cert-manager, k3s | $0 (FOSS) |
| External uptime ping (healthchecks.io / UptimeRobot free tier) | $0 — add one against `/api/healthz`, it's the alert you actually need |

## 8. Honest security posture

Done here: ufw (22/80/443 only, 6443 closed), fail2ban, unattended-upgrades,
key-only SSH, SOPS-encrypted secrets decrypted only in-cluster, ArgoCD
admin-only + project-restricted, TLS everywhere public.

Still demo-grade (deliberately — see readme Phase 2 / AGENTS.md): Keycloak
runs `start-dev` (dev mode), the demo GPG private key is committed (swap to
age + untracked key for anything real), single replicas everywhere, Redis is
a Deployment, sudo is NOPASSWD for `deploy`. Fix those before pointing real
users at it.

## 9. Teardown

```bash
./stop vps --purge    # delete ArgoCD apps (cascades) + k3s-uninstall; /data/postgresql survives
# then destroy the box at your provider; remove the DNS records
```

## 10. Troubleshooting

| Symptom | Fix |
|---|---|
| ansible fails at first task: permission denied (publickey) | provider didn't install your key — use the provider console, or `ssh-copy-id root@<vps>` with a temporary password login |
| Cert stays `READY=False` | DNS not propagated yet (dig it), or port 80 blocked (ufw allows it — check provider firewall too), or LE rate limit (use the staging issuer) |
| Smoke returns 000 / timeout | DNS (test with `curl --resolve` from the script — it already does), provider-level firewall (some VPSes have one outside ufw), or the app still syncing — check ArgoCD UI |
| ArgoCD app `ComparisonError` or plugin error | repo-server plugin logs: `kubectl -n argocd logs deploy/argocd-repo-server -c cmp-helm-secrets`. Most common: helm/sops/helm-secrets version drift after an upgrade — pins live in `group_vars/all.yml` + `roles/argocd/templates/repo-server-helm-secrets.yaml.j2` |
| App `OutOfSync` forever | someone kubectl-edited the cluster — selfHeal *will* revert it; align with git instead |
| Login fails after domain change | you skipped `scripts/build-front.sh` (§3.3) — the SPA still carries the old baked URLs |
| Pods unchanged after secrets edit | see §5 secrets row — rollout restart |
| VPS rebooted | k3s and everything else come back via systemd on their own; check `systemctl status k3s` if not |
| Docker Hub 429 (ImagePullBackOff) | anonymous pull rate limit — wait ~10 min, ArgoCD retry handles it, or authenticate pulls |
