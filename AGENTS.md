# AGENTS.md — guide for coding agents working in this repo

Pet project: a full-stack demo app deployed to Kubernetes through one Helm chart. Authored ~2024, revived 2026, hardened 2026-10 (production-pattern pass: probes/resources/PDBs/netpols/non-root, notes+jobs app, tests, observability). Deploys to four environments through one interface — `./start` (Minikube on the Mac, helm-direct), `./start orbstack` (k3s in an OrbStack Ubuntu machine on the Mac — full rehearsal of the remote pipeline), `./start lan` (k3s in a VirtualBox VM on the Wi-Fi) and `./start vps` (k3s on a VPS with TLS), the remote three via Ansible + ArgoCD GitOps. Everything deployable lives in `helm-chart/`; the application source lives next to it in this repo.

## Entry points

| Command | What it does |
|---|---|
| `./start` | **The one command, per environment.** `./start` = local Minikube (idempotent: minikube + addons → `/etc/hosts` → SOPS/GPG setup → `helm secrets upgrade --install ap` → wait Ready → `minikube tunnel` → automated smoke tests: basic HTTP checks + deep smoke (notes CRUD on both backends, 401 negatives, async job consumed by the worker)). Flags: `--metrics`, `--load-generator`, `--skip-smoke`, `--check-only`, `--reset`. |
| `./start orbstack` / `./start lan` / `./start vps` | remote-style targets (k3s; orbstack = local OrbStack machine, created once by `scripts/orbstack-create.sh`): Ansible bootstrap (hardening → k3s → ingress-nginx → cert-manager (vps) → ArgoCD) → ArgoCD deploys the chart **from git** (helm-secrets CMP sidecar decrypts SOPS in-cluster, renders with `--include-crds`) → wait `Healthy/Synced` → smoke suite (basic + deep) via `curl --resolve`. Flags: `--skip-bootstrap`, `--skip-smoke`. Re-running WITH bootstrap is idempotent and re-applies the ansible-managed ArgoCD bits (CMP plugin, AppProject) — needed after changing `ansible/roles/argocd/templates/*.j2`. |
| `./stop` / `./stop orbstack` / `./stop lan` / `./stop vps` | local: `helm uninstall ap` + stop tunnel (`--purge` deletes minikube). remote: delete ArgoCD apps (cascades); `--purge` also k3s-uninstall. |
| `make status` | local cluster / pods / release / tunnel / URLs; `make status TARGET=orbstack\|lan\|vps` for remote (short-lived ssh tunnel). |
| `make upgrade` | re-deploy chart after changes (local helm upgrade --install). On the remote targets the redeploy mechanism is `git push` (ArgoCD auto-sync); in orbstack local mode the CI mirrors the push to the in-machine repo ArgoCD watches. |
| `make secrets-edit` | edit SOPS-encrypted `secrets.yaml`. After editing, remote pods need `kubectl rollout restart` (env-secrets are read at boot). |
| `scripts/build-front.sh <tag> [values-file]` | rebuild + push the react image with per-environment `VITE_*` baked (needed when the app host isn't `grogu.test`). On orbstack the CI builds it with default `*.test` args instead. |
| `scripts/orbstack-mode.sh local\|github` | first-class GitOps mode switch for orbstack: moves the workflow between `.gitea/` and `.github/`, rewrites repoURL (ap.yaml + group_vars) and the registry, keeps per-mode image state in `.local/orbstack-images-<mode>.yaml`. `status` prints the current mode. |
| `scripts/dev-hosts.sh [target] --install\|--remove` | puts the `*.test` hostnames for a target into `/etc/hosts` (browser access; smoke tests never need them — they use `curl --resolve`). |
| `scripts/orbstack-reset-data.sh` | wipes postgres/redis data inside the orbstack machine — needed once after a major data-service bump (formats are incompatible); everything reseeds via the migration Job. |
| `scripts/monitoring-crds.sh` | applies the kube-prometheus-stack CRDs server-side, out-of-band (they render with `crds.enabled: false` — ArgoCD can't diff their multi-MB schemas). Re-run after bumping the subchart version. |
| `scripts/local-up.sh`, `scripts/local-down.sh`, `scripts/status.sh` | what `./start`, `./stop`, `make status` call locally — read before changing launch behavior. |
| `scripts/remote-up.sh`, `scripts/remote-down.sh`, `scripts/remote-env.sh` | the `orbstack`/`lan`/`vps` engine (sourced helpers live in remote-env.sh: inventory parsing incl. `ansible_port`, ssh tunnel 16443→6443, kubeconfig, smoke incl. `deep_smoke`). |
| `scripts/orbstack-create.sh` | one-time provisioning of the OrbStack rehearsal machine (create ubuntu:24.04 4CPU/8GB, install sshd + key, write the `[orbstack]` inventory group). Idempotent. |
| `scripts/orbstack-local-git.sh` | LOCAL-mode loop: pushes main to the local bare repo (`.local/gitops-origin.git`) served to ArgoCD by the in-machine git daemon; fixes machine-IP drift. Refuses to run in github mode. |
| `scripts/orbstack-registry.sh` | in-cluster `registry:2` (NodePort 30500) + k3s mirror config — the local Docker Hub twin. Idempotent, IP-aware. |
| `scripts/orbstack-gitea.sh` | Gitea + act_runner as Mac containers (port 3000): local GitHub twin with an Actions-compatible CI pipeline (`.gitea/workflows/build-deploy.yml`). Creates admin user (password in `.local/gitea-credentials.txt`; note the file can go stale — the working password is the one baked into the `gitea` remote URL). |
| `ansible/site.yml` + roles | the remote bootstrap (common/k3s/ingress_nginx/cert_manager/argocd/backups_offsite). Pinned upstream versions in `ansible/group_vars/all.yml`; `ansible/ansible.cfg` is applied explicitly by remote-up.sh (bash shell for the roles' `pipefail`, accept-new host keys). |

Docs: `docs/RUN.md` (launch guide for all four environments), `docs/ARCHITECTURE.md` (topology, flows, known issues), `docs/DEPLOY-VPS-ARGOCD.md` (VPS + ArgoCD flow, day-2, costs), `docs/DEPLOY-LAN-VIRTUALBOX.md` (VirtualBox VM provisioning), `docs/ENVIRONMENTS-RU.md` + `docs/HOW-DEPLOY-WORKS-RU.md` (RU), `gitops/README.md` (GitOps practices), `readme.md` (user-facing).

## Repo map

```
helm-chart/                  the single umbrella chart ("bona-helm", release name "ap", kubeVersion >=1.25)
  Chart.yaml                 dep kube-prometheus-stack 65.3.2, condition metrics.enabled (vendored in charts/)
  values.yaml                all config; secrets only from secrets.yaml; hardening.* toggles; kube-prometheus-stack tuning block
  values-lan/orbstack/vps    per-env overlays (orbstack carries the CI-pinned image block + metrics on)
  config/krakend.json        gateway routes (Go-templated): legacy numbers/fibonacci/primes + notes CRUD (both stacks) + jobs; writes are JWT-validated, no-op passthrough, input_headers [Authorization, Content-Type]
  config/realm-export.json   Keycloak realm import (seeds demo/demo; redirect follows host.scheme/host.app)
  migrations/migration-1.sql numbers tables (idempotent)
  migrations/migration-2.sql notes / jobs / daily_reports + demo notes (idempotent)
  templates/                 per-component folders + network-policies.yaml, pod-disruption-budgets.yaml, NOTES.txt,
                             tests/test-connection.yaml (helm test hooks, inert under ArgoCD), monitoring/ (dashboard + rules)
ansible/                     remote bootstrap; roles/argocd/templates carry the CMP plugin (helm secrets template
                             --include-crds), the AppProject (CRDs + prometheus RBAC whitelisted), repo-server patch
gitops/                      ArgoCD Application per env (apps/{orbstack,lan,vps}/ap.yaml); README
nodejs-back/                 Node 22 + express (distroless nonroot): numbers/fibonacci + notes CRUD + jobs producer; src/worker.js (Redis Streams consumer); scripts/daily-report.js (batch); node:test suites (*.test.js)
golang-back/                 Go (go.mod 1.25) + gin, multi-stage distroless nonroot: same notes contract + /numbers POST + /ready + /metrics (promhttp); go test suites
react-front/                 React 18 + TS + Vite, non-root image (USER node, /app chowned): API playground + Notes CRUD view + Jobs view; vitest+testing-library (NotesView.test.tsx)
scripts/                     start/stop/status plumbing + orbstack mode/hosts/reset helpers
diagram-as-code/  ans/  microk8s/   docs assets / UNRELATED scratch dirs (ignore ans/, microk8s/)
```

## Components (namespace `default`)

| Component | Values key | Image | Notes |
|---|---|---|---|
| react-front | `front` | CI-built `grogu-front:$SHA` (registry per mode) | Vite SPA; API playground + Notes + Jobs views; token via keycloak-js PKCE; non-root (USER node) with HOME=/tmp |
| nodejs-back | `nodejsBack` | CI-built `grogu-api:$SHA` | `/numbers` (GET list, POST create), `/fibonacci`, `/notes` CRUD (Redis read-through cache TTL 60s), `/jobs` producer; HPA 1–10 @ CPU 75%; ServiceMonitor |
| nodejs-worker | `nodejsWorker` | same image as nodejsBack, `args: [src/worker.js]` | consumes the `jobs` Redis Stream in consumer group `workers`, writes status/result into the jobs table |
| golang-back | `golangBack` | CI-built `golang-back:$SHA` | same notes contract + `/numbers` POST + `/fibonacci/:n`, `/primes/:n` (parallel partition fixed), `/ready`, `/metrics`; HPA 1–5; ServiceMonitor |
| krakend-gateway | `gateway` | devopsfaith/krakend:2.9.4 | 2 replicas, zero-downtime strategy; all writes through `auth/validator` (RS256 JWKS from Keycloak); `/healthz` dials loopback; metrics on 9090 (ServiceMonitor) |
| keycloak-auth | `auth` | quay.io/keycloak/keycloak:26.8.0 | production `start` (hostname from host.scheme/auth, `--health-enabled --metrics-enabled` on :9000); `auth.devMode: true` is the instant rollback to `start-dev`; bootstrap-admin envs under both names |
| postgres | `postgres` | postgres:17.6-alpine | StatefulSet + hostPath PV (`/data/postgresql`, class `manual`); non-root via volume-permissions init (uid 999); migration Job (version-suffixed name = rerun trigger, deliberately NOT a helm hook — ArgoCD ignores hooks); pg_dumpall CronJob + cleaner + nightly report CronJob (`daily_reports`) |
| redis-cache | `redis` | redis:7.4-alpine | StatefulSet with volumeClaimTemplates (local-path); no securityContext by design (entrypoint privilege dance); AOF on |
| load-generator | `loadGenerator` | digest-pinned busybox | off by default; targets nodejs `/fibonacci` + gateway golang fibonacci (values-templated `targets:`) |
| kube-prometheus-stack | `metrics` | — | off by default, ON for orbstack; trimmed (alertmanager/webhooks/coredns/etcd/cm/scheduler/proxy off, retention 2h); 4 ServiceMonitors (nodejs, golang, krakend :9090, keycloak :9000); Grafana dashboard ConfigMap (sidecar) + 4 PrometheusRules |

Ingress: `grogu.test/` → front, `grogu.test/api/?(.*)` → gateway, `auth.test` → Keycloak, `prom.test`/`grafana.test` → metrics (when enabled).

Startup ordering: init containers (`_helpers.yaml`) wait for Postgres `psql` + Redis `PING`; KrakenD readiness probes nodejs; Keycloak startupProbe tolerates a slow first boot (schema + realm import).

## Conventions & gotchas

- **Release name `ap` is load-bearing** (ingress references `<release>-kube-prometheus-stack-prometheus`, `<release>-grafana`).
- Values keys: `loadGenerator.enable` (not `enabled`), `metrics.enabled`, `auth.devMode`, `hardening.{securityContext,pdb,netpol}` (flip off while debugging), `kube-prometheus-stack.*` (subchart tuning — keyed by the subchart's name, not `metrics`).
- Secrets: `database.*` + `keycloak.*` exist ONLY in `secrets.yaml` (SOPS). REDIS_HOST/PORT moved out of the postgres secret into deployment env.
- CI (`build-deploy.yml`, same file for both modes): chart render matrix on EVERY commit (defaults, lan==defaults, orbstack, vps+tls — streamed into the helm container via stdin tar, NOT `-v` mounts: mounts resolve on the docker daemon, not the job container); per-service tests in pinned toolchain containers BEFORE any push; then build → push `$REGISTRY/$IMAGE:$SHA` → awk block-bump of `values-orbstack.yaml` (block-exact; never `sed` ranges — they overshoot into neighbours) → mirror to the repo ArgoCD watches.
- orbstack GitOps modes: `local` (default; git daemon :9418 + in-cluster registry + Gitea CI) vs `github` (GitHub repo + Docker Hub + Actions; needs GH_PAT/DOCKERHUB secrets). Switch with `scripts/orbstack-mode.sh`; the workflow file is mode-neutral.
- React builds: vite pinned EXACT (5.4.21 — needs `allowedHosts` in PreviewOptions); the Dockerfile installs from package.json WITHOUT the lockfile (a Mac-generated lockfile omits rollup's linux/arm64 optional binary) and `.dockerignore` excludes host `node_modules` (stale darwin binaries broke tsc once); WORKDIR chown before USER node.
- The react image has Keycloak URLs baked at build time; new app host ⇒ `scripts/build-front.sh` + version bump (or a CI rebuild on orbstack).
- KrakenD pass-through semantics: default encoding turns backend non-2xx into 500s — the notes/jobs routes are `no-op` so statuses pass verbatim; `input_headers` is an allow-list (Content-Type must be listed or express's bodyParser skips JSON).
- ArgoCD ignores `helm.sh/hook` resources — the migration Job and `templates/tests/` rely on that (Job reruns by version-bump; helm test is local-only).
- Remote k8s API access goes through an ssh tunnel (`127.0.0.1:16443 → target:6443`); ufw allows 22/80/443 only.
- Postgres/Redis PVs are node-pinned (hostPath/local-path) — single-node only by design.
- Gitea credentials: `.local/gitea-credentials.txt` can go stale; the working password is the one in the `gitea` remote URL.

## Known issues (left as-is on purpose)

- Single replicas everywhere (postgres/redis/keycloak); the PDBs/strategies matter only when that changes.
- Postgres on hostPath `manual` PV, backups land on the same volume — node loss loses both; no restore tooling (pg_dumpall files are plain SQL).
- ArgoCD SOPS path uses the committed demo PGP key (swap to age + untracked key before anything real).
- golang `/numbers/` keeps its trailing-slash group route (krakend calls `/notes/` for golang lists); nodejs uses `/numbers`.
- JS/Go dependency scan shows Dependabot findings (mostly transitive, dev-time) — not triaged.
- act_runner runs on the Mac (one build lane); the registry `emptyDir` loses images on reschedule (rebuild is one push away).
- `helm lint` fails on the one known `.Values.database.name` error by design (secrets only in secrets.yaml).
- OrbStack machine is 8 GB (fixed at create time); the metrics stack fits only because the subchart block trims it.

## Launch-critical fixes already applied (don't undo)

- redis.conf in the configmap (bind all / dir /data/redis / AOF) — without it Redis crashloops and backends hang on init.
- Postgres PV hostPath `DirectoryOrCreate`; postgres runs as uid 999 via the volume-permissions init (subPath defeats fsGroup).
- Distinct `stack: nodejs|golang|worker` labels; Services select on them (the old shared `app: back` made each Service target BOTH Deployments).
- Keycloak `KC_DB*` env + postgres netpol; the CI image bump stages `values-orbstack.yaml` (not `values.yaml`) and edits exactly one top-level block via awk.
- KrakenD `/healthz` dials loopback and its liveness probe is tcpSocket — the old self-dial through the Service restart-looped both replicas during rollouts.
- The CMP plugin renders with `--include-crds`; without it the monitoring CRDs never rendered and the metrics sync failed wholesale.
- ArgoCD AppProject whitelists CRDs + prometheus RBAC (kube-prom-stack cannot sync otherwise).
- golang primes partition covers 2..limit contiguously (the old math skipped most numbers — π(10) returned 1).
- React image: `.dockerignore` (host node_modules leaked darwin binaries), vite pinned 5.4.21, `/app` chowned before USER node (vite's config loader writes a temp bundle there).
- Worker passes the script via `args` (distroless ENTRYPOINT knows the node path — `/usr/bin/node` does not exist); XGROUP CREATE via raw command (node-redis 4.7 drops the MK option).
- Front deployment pins numeric `runAsUser: 1000` — kubelet cannot verify a NAMED image user as non-root.

## Verification workflow for changes

1. `helm lint ./helm-chart` — expect exactly one pre-existing ERROR (`.Values.database.name`); anything else is yours.
2. Render matrix (the same one CI runs): defaults, `-f values-lan.yaml` (must equal defaults), `-f values-orbstack.yaml` (add `--include-crds` when touching metrics), `-f values-vps.yaml --set tls.email=t@e.st` (must contain ClusterIssuer + TLS block). All with the throwaway `--set` secrets.
3. Unit tests: `npm test` in nodejs-back (node:test), `go vet ./... && go test ./...` in golang-back, `npm test` (vitest) + `npx tsc -b` in react-front. CI runs these in pinned containers and blocks pushes on failure.
4. Remote plumbing: `bash -n scripts/*.sh`; `ansible-playbook -i ansible/inventory.sample.ini ansible/site.yml --syntax-check`.
5. Real check: `make upgrade` (or `./start` / `./start orbstack --skip-bootstrap`) until pods are Ready; the smoke suite (basic + deep: notes CRUD both stacks, 401 negatives, worker job with fib(10)=55) runs automatically. Chart-wide smoke: `helm test ap` (local helm only).
6. Changing `ansible/roles/argocd/templates/*.j2` (CMP plugin, AppProject) requires a full `./start orbstack` (re-applies ansible), not `--skip-bootstrap`.
