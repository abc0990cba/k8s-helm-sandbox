# Running the app in every environment

One interface, four environments — `./start` with no argument (local
Minikube on this Mac), `./start orbstack` (the same pipeline rehearsed in an
OrbStack Linux machine, also on this Mac), `./start lan` (k3s in a VirtualBox
VM on your Wi-Fi) and `./start vps` (k3s on a rented VPS with TLS). All of
them end with the same automated smoke tests; when they pass, the app is up.

| | **local** (default) | **orbstack** | **lan** | **vps** |
|---|---|---|---|---|
| Command | `./start` | `./start orbstack` | `./start lan` | `./start vps` |
| Cluster | Minikube (docker driver) on this Mac | k3s in an Ubuntu 24.04 machine in OrbStack, on this Mac | k3s in an Ubuntu VM (VirtualBox) | k3s on a rented Linux box |
| Deployed by | `helm secrets upgrade --install` directly from this repo | Ansible bootstrap → **ArgoCD deploys the chart from git** | same as orbstack | same as orbstack, plus TLS |
| App URL | [http://grogu.test/](http://grogu.test/) (via `minikube tunnel`) | `http://grogu.test/` (hosts file → machine IP) | `http://grogu.test/` (hosts file → VM IP) | `https://<your-domain>/` (Let's Encrypt) |
| Re-deploy after changes | `make upgrade` | `./scripts/orbstack-local-git.sh` (local remote) — or `git push` in GitHub mode | `git push` | `git push` |
| Tear down | `./stop` (cluster kept) / `./stop --purge` (cluster deleted) | `./stop orbstack` / `--purge` | `./stop lan` / `./stop lan --purge` | `./stop vps` / `./stop vps --purge` |
| Status | `make status` | `make status TARGET=orbstack` | `make status TARGET=lan` | `make status TARGET=vps` |
| Deep dive | this page + readme.md | this page | [DEPLOY-LAN-VIRTUALBOX.md](./DEPLOY-LAN-VIRTUALBOX.md) | [DEPLOY-VPS-ARGOCD.md](./DEPLOY-VPS-ARGOCD.md) |

What orbstack is **for**: it runs the *exact* lan/vps pipeline — Ansible
bootstrap (hardening → k3s → ingress-nginx → ArgoCD + helm-secrets) → ArgoCD
syncing the chart **from git** → the same smoke suite — against a Linux
machine that lives on your Mac. Test every ansible/gitops/chart change there
in minutes, without touching Windows/VirtualBox or renting anything.

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

## 2. OrbStack — the remote pipeline, rehearsed on this Mac (`./start orbstack`)

> **Как это всё работает внутри** — куда едет ваш коммит, что такое Helm и
> ArgoCD, как правка кнопки доезжает до браузера: пошаговый разбор для
> начинающих — [HOW-DEPLOY-WORKS-RU.md](./HOW-DEPLOY-WORKS-RU.md) (на русском).

A real Ubuntu 24.04 machine (same distro as the lan VM and the VPS) running
inside [OrbStack](https://orbstack.dev) on this Mac, bootstrapped by the same
Ansible playbook as the other remote targets: hardening → k3s → ingress-nginx
→ **ArgoCD, which deploys the chart as GitOps** (helm-secrets decrypts
`secrets.yaml` in-cluster). If `./start orbstack` is green, `./start lan` /
`./start vps` behave the same — only the address and (on vps) TLS differ.

### Prerequisites (once)

```bash
brew install orbstack          # then start OrbStack.app once
brew install ansible kubectl helm
ansible-galaxy collection install -r ansible/requirements.yml
ssh-keygen -t ed25519          # if you don't have ~/.ssh/id_ed25519 yet
```

### From scratch — three commands, in this order

```bash
./scripts/orbstack-create.sh       # 1. machine: Ubuntu 24.04, 4 CPU / 8 GB,
                                   #    sshd + your key, [orbstack] inventory entry
./scripts/orbstack-local-git.sh    # 2. local git remote: ArgoCD will sync the
                                   #    chart from your Mac — no GitHub needed
./start orbstack                   # 3. bootstrap + deploy + smoke tests
```

- Step 1 is idempotent — it creates or repairs the `k3s-orbstack` machine,
  installs sshd inside it, and writes the `[orbstack]` group into
  `ansible/inventory.ini`.
- Step 2 creates the bare repo `.local/gitops-origin.git` (gitignored) and a
  `git daemon` systemd service **inside the machine** that serves it through
  OrbStack's `/mnt/mac` mount — the repo never crosses the network, and it
  also tracks the machine's IP automatically.
- Step 3 re-runs are idempotent: the playbook `ok`s through in ~2 minutes,
  then waits for the app. First run: ~10 min bootstrap + first image pulls
  (up to ~25 min). The k8s API goes through an ssh tunnel
  (`127.0.0.1:16443 → machine:6443`) the script manages; smoke tests use
  `curl --resolve`, so they never depend on hosts files.

### Everyday loop — change → deploy

```bash
# edit helm-chart/, gitops/ or ansible/ ...
git add -A && git commit -m "my change"
./scripts/orbstack-local-git.sh       # push local main -> the local remote
./start orbstack --skip-bootstrap    # optional: force the sync + re-run smokes
```

ArgoCD also auto-syncs on its own within ~3 minutes of each push. Watch with
`make status TARGET=orbstack`.

### Browser access

The app serves at `http://grogu.test/` (login **demo / demo**; Keycloak
console `http://auth.test/`, admin/admin). Smoke tests don't need hosts
entries, but a browser does — point the names at the machine IP (the
`orbstack-local-git.sh` output prints it):

```bash
sudo sh -c 'printf "192.168.139.195 grogu.test auth.test prom.test grafana.test\n" >> /etc/hosts'
```

- If the machine IP ever changes, re-run `./scripts/orbstack-local-git.sh`
  (it fixes inventory + ArgoCD URLs automatically) and update this line.
- **`ERR_ADDRESS_UNREACHABLE` or stale page in your own browser?** Fully quit
  the browser (Cmd+Q) and reopen — it caches failed connections from before
  the hosts edit. If that doesn't help: try an incognito window (rules out
  extensions/proxy-switchers), turn off Chrome's *Use secure DNS*, and pause
  any VPN/accelerator app — it may route the browser away from OrbStack's
  private subnet. (The ZCode built-in browser is a clean instance and always
  works.)
- **Switching browser between local Minikube and orbstack**: only one can own
  `grogu.test` at a time. To orbstack: stop local (`./stop`), hosts → machine
  IP (above). Back to local: flip the hosts entries to `127.0.0.1`, then
  `./start` (it restores the tunnel).

### Two sync modes

| | **local remote** (default on this Mac) | **GitHub** |
|---|---|---|
| ArgoCD clones from | `git://<machine-ip>:9418/gitops-origin.git` | `github.com/abc0990cba/k8s-helm-sandbox` |
| Deploy your changes | `./scripts/orbstack-local-git.sh` | `git push` |
| Needs internet/GitHub | no | yes |
| Switch | — | comment `repo_url` in `ansible/group_vars/orbstack.yml`, `git revert` the commits marked **TEMPORARY**, `git push origin main` |

The same GitHub mode is what `./start lan` and `./start vps` use — rehearsing
there is a matter of pointing the inventory at those machines.

### Teardown

```bash
./stop orbstack               # delete the ArgoCD apps (cascades the workloads)
./stop orbstack --purge       # also k3s-uninstall inside the machine
orb delete k3s-orbstack       # remove the machine itself (frees the disk)
# then drop the [orbstack] block from ansible/inventory.ini
```

### Notes

- TLS is off (`tls_enabled: false` in `ansible/group_vars/orbstack.yml`) —
  `*.test` can't get real certificates. To rehearse the vps TLS branch, set
  it to `true` and give `helm-chart/values-orbstack.yaml` sslip.io-style
  domains + `tls.email`.
- Keep the machine out of sleep while testing: a suspended OrbStack machine
  suspends the cluster. OrbStack restarts the machine (and k3s) on demand.
- Postgres data lives at `/data/postgresql` inside the machine and survives
  `./stop orbstack` and reboots; only `orb delete` (or `--purge` + manual
  wipe) removes it.

---

## 3. LAN — k3s in a VirtualBox VM (`./start lan`)

Same stack, same chart, same `*.test` names — running on a Linux VM and driven
from the Mac over Wi-Fi. Deploy is **GitOps**: Ansible bootstraps the VM, then
ArgoCD deploys the chart from this git repository (helm-secrets decrypts
`secrets.yaml` in-cluster).

### Prerequisites (once)

1. The Ubuntu 24.04 VM exists and is reachable over ssh — provision it on the
   Windows/VirtualBox host following steps 1–5 of
   [DEPLOY-LAN-VIRTUALBOX.md](./DEPLOY-LAN-VIRTUALBOX.md). That guide's
   **chapter 2 is a four-checkpoint network pre-flight** (MacBook → Windows
   host → VM → ports 22/6443/80/443) — run it *before* installing anything,
   so reachability problems surface while they're still cheap to fix.
   **No router access (or don't want to touch the home network)?** §2.7 of
   the same guide is the chapter for you: in the common case the router needs
   zero changes (the VM just takes a static IP), and even a client-isolated
   Wi-Fi is bypassed with a direct USB-Ethernet cable or a NAT+port-forward
   setup — both end in the exact same `./start lan`.
2. On the Mac: `brew install ansible kubectl helm` and
   `ansible-galaxy collection install -r ansible/requirements.yml`.
3. `ansible/inventory.ini` lists the VM (copy from
   `ansible/inventory.sample.ini`; the real file is gitignored — the sample
   also shows the variants for the cable and NAT setups).
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

## 4. VPS — k3s + TLS (`./start vps`)

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
  Edit with `make secrets-edit`. On the remote targets (orbstack/lan/vps),
  pods read secrets at boot — after editing, `kubectl rollout restart` the
  deployments (ArgoCD re-syncs the secret, but pods still need a restart).
- **Smoke tests** are the same everywhere: front page, gateway `/api/healthz`,
  both backends' public endpoints, Keycloak realm, and both private endpoints
  with a JWT from the seeded `demo/demo` user (Direct Access Grants are ON on
  the `reactclient` exactly for this).
- **Everything deployable lives in `helm-chart/`**; the same chart is rendered
  by helm locally and by ArgoCD remotely, with per-environment overlays
  (`values-orbstack.yaml` / `values-lan.yaml` / `values-vps.yaml`) on top of
  `values.yaml`.
- **Lost?** `make status` (add `TARGET=orbstack|lan|vps` for remote), or read
  [ARCHITECTURE.md](./ARCHITECTURE.md) for how the pieces fit together.
