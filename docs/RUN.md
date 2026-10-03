# Running the app in every environment

One interface, three environments — `./start` with no argument (local
Minikube on this Mac), `./start lan` (k3s in a VirtualBox VM on your Wi-Fi) and
`./start vps` (k3s on a rented VPS with TLS). All three end with the same
automated smoke tests; when they pass, the app is up.

| | **local** (default) | **lan** | **vps** |
|---|---|---|---|
| Command | `./start` | `./start lan` | `./start vps` |
| Cluster | Minikube (docker driver) on this Mac | k3s in an Ubuntu VM (VirtualBox) | k3s on a rented Linux box |
| Deployed by | `helm secrets upgrade --install` directly from this repo | Ansible bootstrap → **ArgoCD deploys the chart from git** | same as lan, plus TLS |
| App URL | [http://grogu.test/](http://grogu.test/) (via `minikube tunnel`) | `http://grogu.test/` (hosts file → VM IP) | `https://<your-domain>/` (Let's Encrypt) |
| Re-deploy after changes | `make upgrade` | `git push` (ArgoCD auto-syncs) | `git push` |
| Tear down | `./stop` (cluster kept) / `./stop --purge` (cluster deleted) | `./stop lan` / `./stop lan --purge` | `./stop vps` / `./stop vps --purge` |
| Status | `make status` | `make status TARGET=lan` | `make status TARGET=vps` |
| Deep dive | this page + readme.md | [DEPLOY-LAN-VIRTUALBOX.md](./DEPLOY-LAN-VIRTUALBOX.md) | [DEPLOY-VPS-ARGOCD.md](./DEPLOY-VPS-ARGOCD.md) |

---

## 1. Local — Minikube on this Mac (`./start`)

### Prerequisites (once)

macOS with Docker Desktop, minikube, helm, sops, gpg and the helm-secrets
plugin:

```bash
brew install --cask docker      # then start Docker Desktop once, give it ≥ 8 GB
brew install minikube helm sops gnupg
helm plugin install https://github.com/jkroepke/helm-secrets --version v4.6.2
make check                      # verifies everything at once
```

kubectl is optional — the script falls back to minikube's built-in one.

### Launch

```bash
./start
```

That is the whole procedure. The script is **idempotent** — run it again at
any time and it repairs/resumes instead of failing. Step by step it:

1. checks prerequisites and starts Docker Desktop if needed;
2. creates/starts the minikube cluster (docker driver, Calico CNI), sized from
   the Docker Desktop VM (the chart requests ~5Gi);
3. enables the addons (metrics-server, ingress, ingress-dns, storage, dashboard);
4. appends `auth.test grogu.test grafana.test prom.test → 127.0.0.1` to
   `/etc/hosts` (asks for the sudo password the first time only);
5. imports the demo GPG key and presets its passphrase, so SOPS decryption of
   `secrets.yaml` never prompts;
6. installs/upgrades the helm release `ap` from `./helm-chart`;
7. waits until every pod is Ready (the postgres migration Job seeds the demo data);
8. starts `sudo minikube tunnel` in the background (asks for the sudo password);
9. runs the smoke suite through the ingress: front page, gateway health, public
   APIs of both backends, Keycloak realm, and the **private** APIs with a real
   JWT obtained for the seeded user `demo/demo`.

Then open [http://grogu.test/](http://grogu.test/) and log in with
**demo / demo** (Keycloak admin console: [http://auth.test/](http://auth.test/),
**admin / admin**). A first run downloads several GB of images (10–20 min);
later runs take a few minutes.

### Flags

```bash
./start --metrics          # + Prometheus & Grafana (prom.test / grafana.test)
./start --load-generator   # + busybox load generator to watch the HPA scale
./start --skip-smoke       # skip the automated end-to-end checks
./start --check-only       # preflight checks only, changes nothing
./start --reset            # delete the minikube profile first (clean slate)
```

Flags can also follow the target: `./start local --metrics`.

### Self-repair and clean slates

- **Interrupted a previous run (Ctrl-C) and `./start` now fails at
  `minikube start`?** A killed first run can leave the node half-wiped (empty
  `/etc/kubernetes/pki`, kubelet crash-looping, `K8S_APISERVER_MISSING`). The
  script detects this, prints the real error from
  `.local/minikube-start.log`, deletes the broken profile and recreates the
  cluster automatically — in-cluster demo data is re-seeded by the migration
  Job. To force the same reset by hand: `./start --reset`.
- **URLs stopped resolving after sleep/reboot** — the tunnel died; `./start`
  again detects and restarts it.
- **Full logs** live in `.local/`: `minikube-start.log`, `tunnel.log`,
  `port-forward.log` (the last one is used only in non-interactive sessions,
  where no sudo/TTY is available to run the tunnel — the smoke tests still
  pass through a temporary `kubectl port-forward`, but browser URLs need a
  real `./start` from a terminal once).

### Stop / inspect

```bash
./stop            # helm uninstall ap + stop the tunnel; the cluster is kept
./stop --purge    # additionally delete the whole minikube cluster
make status       # cluster / pods / release / tunnel / URLs
```

---

## 2. LAN — k3s in a VirtualBox VM (`./start lan`)

Same stack, same chart, same `*.test` names — running on a Linux VM and driven
from the Mac over Wi-Fi. Deploy is **GitOps**: Ansible bootstraps the VM, then
ArgoCD deploys the chart from this git repository (helm-secrets decrypts
`secrets.yaml` in-cluster).

### Prerequisites (once)

1. The Ubuntu 24.04 VM exists and is reachable over ssh — provision it
   following steps 1–5 of
   [DEPLOY-LAN-VIRTUALBOX.md](./DEPLOY-LAN-VIRTUALBOX.md).
2. On the Mac: `brew install ansible kubectl helm` and
   `ansible-galaxy collection install -r ansible/requirements.yml`.
3. `ansible/inventory.ini` lists the VM (copy from
   `ansible/inventory.sample.ini`; the real file is gitignored).
4. Your Mac's hosts file points `grogu.test auth.test` at the **VM's IP** (the
   guide shows the lines; unlike local, they are **not** managed by `./start`).

### Launch

```bash
./start lan                # full bootstrap + ArgoCD deploy + smoke tests
./start lan --skip-bootstrap   # cluster already bootstrapped — only sync/deploy/smoke
./start lan --skip-smoke
```

What it does: Ansible roles (common hardening → k3s → ingress-nginx → ArgoCD)
→ wait for the ArgoCD Application to become `Healthy/Synced` → the same smoke
suite via `curl --resolve`. The k8s API is reached through an ssh tunnel
(`127.0.0.1:16443 → VM:6443`) that the script manages for you.

### Re-deploys are `git push`

ArgoCD watches the repo and auto-syncs: commit + push a chart change and the
VM picks it up. Do **not** run `./start` (no target) or `make upgrade` while
targeting the VM — they are hardwired to local Minikube.

### Stop

```bash
./stop lan                 # delete the ArgoCD app (cascades the workloads)
./stop lan --purge         # additionally k3s-uninstall on the VM
```

---

## 3. VPS — k3s + TLS (`./start vps`)

Identical flow to `lan`, against a rented Ubuntu box, with cert-manager +
Let's Encrypt in front:

1. Create the VPS (Ubuntu 24.04, **4 vCPU / 8 GB / 60+ GB**, ssh key access) —
   sizing, providers and costs in
   [DEPLOY-VPS-ARGOCD.md](./DEPLOY-VPS-ARGOCD.md).
2. Point DNS at it (real domain, or `sslip.io` for zero-cost), then set
   `helm-chart/values-vps.yaml` — the `host.*` names, `host.scheme: https` and
   `tls.email` (the chart refuses to render TLS without an email).
3. List the host in `ansible/inventory.ini`, then:

```bash
./start vps                # hardening → k3s → ingress-nginx → cert-manager → ArgoCD → smoke
./start vps --skip-bootstrap
```

Re-deploys: `git push`. Tear down: `./stop vps` / `./stop vps --purge`.
Day-2 (backups, upgrades, secrets rotation) is covered in
[DEPLOY-VPS-ARGOCD.md](./DEPLOY-VPS-ARGOCD.md).

---

## Good to know in every environment

- **Secrets** (`database.*`, `keycloak.*`) live only in the SOPS-encrypted
  `secrets.yaml` (demo PGP key, passphrase `example1` — committed on purpose).
  Edit with `make secrets-edit`. On `lan`/`vps`, pods read secrets at boot —
  after editing, `kubectl rollout restart` the deployments (or `git push` a
  changed secret; ArgoCD re-syncs but pods still need a restart).
- **Smoke tests** are the same everywhere: front page, gateway `/api/healthz`,
  both backends' public endpoints, Keycloak realm, and both private endpoints
  with a JWT from the seeded `demo/demo` user (Direct Access Grants are ON on
  the `reactclient` exactly for this).
- **Everything deployable lives in `helm-chart/`**; the same chart is rendered
  by helm locally and by ArgoCD remotely, with per-environment overlays
  `values-lan.yaml` / `values-vps.yaml` on top of `values.yaml`.
- **Lost?** `make status` (add `TARGET=lan|vps` for remote), or read
  [ARCHITECTURE.md](./ARCHITECTURE.md) for how the pieces fit together.
