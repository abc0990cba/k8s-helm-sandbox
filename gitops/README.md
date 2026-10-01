# GitOps — how `lan` and `vps` deploy, and the practices behind it

After `./start lan` or `./start vps` finishes its Ansible bootstrap, the cluster
owns its own deployment state: **ArgoCD watches this git repository and applies
the chart automatically**. From then on:

```bash
git push                # deploy (ArgoCD auto-syncs within ~3 min)
```

and the single-command entry stays `./start lan` / `./start vps` — rerunning it
is safe anytime: Ansible is idempotent and the script just waits for ArgoCD to
reach `Healthy/Synced`.

```
./start vps
   └─ ansible (site.yml, idempotent)
        ├─ common        hardening: ufw 22/80/443, fail2ban, unattended-upgrades, swap off, deploy user
        ├─ k3s           single node, --disable traefik
        ├─ ingress_nginx ServiceLB binds :80/:443 on the node
        ├─ cert_manager  (vps) so the chart's ClusterIssuer can issue Let's Encrypt certs
        └─ argocd        install + helm-secrets CMP sidecar + AppProject + root app + admin pw
             └─ root Application → gitops/apps/vps/ap.yaml → Application `ap`
                  └─ helm-secrets template helm-chart -f ../secrets.yaml -f values-vps.yaml
```

## What lives where

| Path | Role |
|---|---|
| `gitops/apps/<env>/ap.yaml` | the real Application: repo, branch, plugin + values files, sync policy. The **only** thing you edit to change how an env deploys. |
| `gitops/bootstrap` | *(not needed)* the root Application is rendered by the `argocd` ansible role because its path depends on the target group |
| `ansible/roles/argocd/templates/project.yaml.j2` | AppProject `ap`: source repo pinned, destinations pinned to `default`/`argocd` namespaces, cluster-resource whitelist (PV, ClusterIssuer, CRD) — the chart cannot mutate anything else |
| `ansible/roles/argocd/templates/repo-server-helm-secrets.yaml.j2` | helm-secrets CMP sidecar + SOPS key import (see below) |

## The practices this follows (and why)

- **App-of-apps**: the bootstrap applies one root Application; everything else
  (now and later — monitoring, extra apps) is added by editing git, not by
  kubectl-ing into the cluster. Adding a second app later = one more YAML in
  `gitops/apps/<env>/`.
- **Explicit sync policy**: `automated.prune+selfHeal` — manual `kubectl edit`
  drift is reverted; removed manifests are deleted. `PruneLast` so a bad
  restructure doesn't tear down dependencies first; retries with backoff ride
  out registry hiccups.
- **Least privilege**: AppProject whitelist/blacklist above; ArgoCD RBAC set to
  `role:none` (admin-only UI); anonymous access disabled; admin password is
  bcrypt-set by Ansible and stored on your Mac at
  `.local/argocd-<env>-admin-pw`.
- **Secrets stay encrypted in transit and at rest in git**: `secrets.yaml` is
  SOPS+PGP and is only ever decrypted *inside* the cluster, by the
  helm-secrets sidecar on `argocd-repo-server`, using the committed **demo**
  key. ⚠️ That key is public on purpose (pet project). For anything real:
  generate an **age** key, re-encrypt `secrets.yaml` (`sops --age ...`), store
  the private key as the `argocd-sops-gpg` replacement Secret, and never
  commit it — the `.sops.yaml` creation rule is the only file you keep in git.
- **Pinned versions everywhere** (k3s channel aside): ArgoCD, cert-manager,
  ingress-nginx, helm, sops, helm-secrets — see `ansible/group_vars/all.yml`.
  Bump deliberately: edit + rerun `./start <target>`.

## Day-2 operations (on the cluster, from the UI)

- UI at `http://argocd.test` (lan) / `https://argocd.<your-domain>` (vps);
  admin password in `.local/argocd-<env>-admin-pw`.
- **Image bump flow**: edit `version:` in `helm-chart/values.yaml` (or the
  overlay) → commit → push → ArgoCD syncs. React images additionally need
  `scripts/build-front.sh <tag>` first (VITE_* is baked).
- **Diff/drift debugging**: app card → *Diff*; OutOfSync with no local change
  usually means someone edited the cluster → selfHeal reverts it by design.
- **Refresh vs Hard Refresh**: *Refresh* re-reads git; *Hard Refresh* also
  rebuilds the helm-secrets render cache — use it after changing the SOPS key.
- Health stuck `Progressing` after a chart edit: `kubectl -n argocd get
  application ap -o yaml | yq '.status.conditions'` shows the message; the
  most common cause is a failed migration Job (bump
  `postgres.migration.version` when changing SQL).

## ArgoCD vs Flux (if you ever re-evaluate)

| | ArgoCD (this repo) | Flux v2 |
|---|---|---|
| SOPS | needs the CMP sidecar above | **native** decryption via a key Secret |
| UI | full web UI, diffs, rollback | none (3rd-party) |
| Bootstrap | manifest apply (done by Ansible) | `flux bootstrap` |
| Fit | app-centric, great UI for a demo | leaner, CI/CD-flavored |

Both are fine; ArgoCD stays because the UI makes the demo legible. The Flux
equivalent would be a `GitRepository` + `HelmRelease` with `decrypt.reference`
pointing at a Secret holding the key.

## Next automation steps (documented, not installed)

- **ApplicationSet** — only worth it when a third environment appears.
- **ArgoCD Image Updater** or **Renovate** — auto-bump image tags on new
  pushes; today you bump `version:` by hand, which keeps the demo honest.
- **ArgoCD Notifications** — Telegram/Slack ping on sync/health events.
- **GitLab CI** — build+scan images (trivy) on push; deliberately out of scope
  for now, deploys don't need it (ArgoCD *is* the deploy side).
