# AGENTS.md — guide for coding agents working in this repo

Pet project: a full-stack demo app deployed to Kubernetes through one Helm chart. Authored ~2024, revived 2026. Deploys to four environments through one interface — `./start` (Minikube on the Mac, helm-direct), `./start orbstack` (k3s in an OrbStack Ubuntu machine on the Mac — full rehearsal of the remote pipeline), `./start lan` (k3s in a VirtualBox VM on the Wi-Fi) and `./start vps` (k3s on a VPS with TLS), the remote three via Ansible + ArgoCD GitOps. Everything deployable lives in `helm-chart/`; the application source lives next to it in this repo.

## Entry points

| Command | What it does |
|---|---|
| `./start` | **The one command, per environment.** `./start` = local Minikube (idempotent: minikube + addons → `/etc/hosts` → SOPS/GPG setup → `helm secrets upgrade --install ap` → wait Ready → `minikube tunnel` → automated E2E smoke tests incl. JWT-authenticated private endpoints). Flags: `--metrics`, `--load-generator`, `--skip-smoke`, `--check-only`, `--reset`. |
| `./start orbstack` / `./start lan` / `./start vps` | remote-style targets (k3s; orbstack = local OrbStack machine, created once by `scripts/orbstack-create.sh`): Ansible bootstrap (hardening → k3s → ingress-nginx → cert-manager (vps) → ArgoCD) → ArgoCD deploys the chart **from git** (helm-secrets CMP sidecar decrypts SOPS in-cluster) → wait `Healthy/Synced` → same smoke suite via `curl --resolve`. Flags: `--skip-bootstrap`, `--skip-smoke`. Targets + IPs come from `ansible/inventory.ini` (gitignored; sample committed). |
| `./stop` / `./stop orbstack` / `./stop lan` / `./stop vps` | local: `helm uninstall ap` + stop tunnel (`--purge` deletes minikube). remote: delete ArgoCD apps (cascades); `--purge` also k3s-uninstall. |
| `make status` | local cluster / pods / release / tunnel / URLs; `make status TARGET=orbstack\|lan\|vps` for remote (short-lived ssh tunnel). |
| `make upgrade` | re-deploy chart after changes (local helm upgrade --install). On lan/vps the redeploy mechanism is `git push` (ArgoCD auto-sync); on orbstack it's `./scripts/orbstack-local-git.sh` (local remote) or `git push` in GitHub mode. |
| `make secrets-edit` | edit SOPS-encrypted `secrets.yaml`. After editing, remote pods need `kubectl rollout restart` (env-secrets are read at boot). |
| `scripts/build-front.sh <tag> [values-file]` | rebuild + push the react image with per-environment `VITE_*` baked (needed when the app host isn't `grogu.test`). |
| `scripts/local-up.sh`, `scripts/local-down.sh`, `scripts/status.sh` | what `./start`, `./stop`, `make status` call locally — read before changing launch behavior. |
| `scripts/remote-up.sh`, `scripts/remote-down.sh`, `scripts/remote-env.sh` | the `orbstack`/`lan`/`vps` engine (sourced helpers live in remote-env.sh: inventory parsing incl. `ansible_port`, ssh tunnel 16443→6443, kubeconfig, smoke). |
| `scripts/orbstack-create.sh` | one-time provisioning of the OrbStack rehearsal machine (create ubuntu:24.04, install sshd + key, write the `[orbstack]` inventory group). Idempotent. |
| `scripts/orbstack-local-git.sh` | orbstack deploy button: pushes local main to the local bare repo (`.local/gitops-origin.git`) that the in-machine git daemon serves to ArgoCD — GitHub-free rehearsal. Also fixes the machine IP in inventory/ArgoCD URLs when it changes. |
| `ansible/site.yml` + roles | the remote bootstrap (common/k3s/ingress_nginx/cert_manager/argocd/backups_offsite). Pinned upstream versions in `ansible/group_vars/all.yml`; `ansible/ansible.cfg` is applied explicitly by remote-up.sh (bash shell for the roles' `pipefail`, accept-new host keys). |

Docs: `docs/RUN.md` (launch guide for all four environments — prerequisites, flags, self-repair, teardown), `docs/ARCHITECTURE.md` (topology, flows, known issues), `docs/DEPLOY-VPS-ARGOCD.md` (VPS + ArgoCD flow, day-2, costs), `docs/DEPLOY-LAN-VIRTUALBOX.md` (VirtualBox VM provisioning, network pre-flight, router-free bypasses + manual walkthrough), `gitops/README.md` (GitOps practices), `readme.md` (user-facing).

## Repo map

```
helm-chart/                  the single umbrella chart ("bona-helm", release name "ap")
  Chart.yaml                 dependency: kube-prometheus-stack 65.3.2, condition metrics.enabled (vendored in charts/)
  values.yaml                all config; secrets come only from secrets.yaml; host.scheme + tls.* drive URLs/TLS
  values-lan.yaml            overlay for ./start lan (http + *.test — matches defaults, explicit for ArgoCD)
  values-orbstack.yaml       overlay for ./start orbstack (same shape as values-lan.yaml)
  values-vps.yaml            overlay for ./start vps (https + real domains + tls.email — TODOs marked)
  secrets.yaml (root)        SOPS+PGP encrypted: database.{name,user,password}, keycloak.{adminName,adminPassword}
  .sops.yaml  demo-secret-key.asc   SOPS config + demo PGP private key (passphrase: example1) — public on purpose
  config/krakend.json        gateway config (Go-templated; CORS follows host.scheme/host.app)
  config/realm-export.json   Keycloak realm import (Go-templated; seeds user demo/demo; reactclient redirect follows host.scheme/host.app)
  migrations/migration-1.sql creates + seeds nodejs_numbers (3087), golang_numbers (1703); runs via a k8s Job
  templates/                 one folder per component (+ cert-issuer.yaml, gated on tls.enabled)
ansible/                     remote bootstrap: ansible.cfg (explicitly applied by remote-up.sh), inventory.sample.ini (real inventory.ini gitignored), site.yml, group_vars/{all,lan,orbstack,vps}.yml, roles/{common,k3s,ingress_nginx,cert_manager,argocd,backups_offsite}
gitops/                      committed ArgoCD manifests: apps/{orbstack,lan,vps}/ap.yaml (the Application per env); README explains the practices
nodejs-back/                 Node 22 + express API (Dockerfile: distroless)
golang-back/                 Go 1.21 + gin API (Dockerfile; needs .env locally — godotenv log.Fatal — but NOT in cluster)
react-front/                 React 18 + TS + Vite SPA (Dockerfile takes VITE_* build args — defaults reproduce *.test)
diagram-as-code/             python `diagrams` scripts + PNGs used by readme
ans/, microk8s/              UNRELATED scratch dirs — ignore them
```

## Components (what the chart deploys, namespace `default`)

| Component | Values key | Image | Service → port | Notes |
|---|---|---|---|---|
| react-front | `front` | mmko67/grogu-front:0.3.6 | react-front-clusterip 9071→8080 | VITE_* env vars in the template are no-ops (baked at build time); Keycloak URLs point at `auth.test`/`grogu.test` |
| nodejs-back | `nodejsBack` | mmko67/grogu-api:0.1.6 | nodejs-back-clusterip 9070→8080 | `/numbers`, `/fibonacci`, `/healthz`, `/metrics`; HPA 1–10 @ CPU 75%; ServiceMonitor |
| golang-back | `golangBack` | mmko67/golang-back:0.0.8 | golang-back-clusterip 8800→8081 | `/numbers/`, `/fibonacci/:n`, `/primes/:n`, `/healthz`; no metrics/HPA yet |
| krakend-gateway | `gateway` | devopsfaith/krakend:2.7 | krakend-gateway-clusterip 8787→8080 | 2 replicas; routes `/v1/nodejs/*`, `/v1/golang/*`; `/v1/*/private` validate JWT (RS256) against Keycloak JWKS; metrics on 9090 |
| keycloak-auth | `auth` | quay.io/keycloak/keycloak:25.0.6 | keycloak-auth-clusterip 8080→8080 | `start-dev --import-realm`; realm `demorealm`, client `reactclient` (redirect `http://grogu.test/`, direct access grants ON); DB: Postgres via `KC_DB*` env; seed user from `values.yaml auth.seedUser` |
| postgres | `postgres` | postgres:14.0 | postgres-clusterip 5432 | StatefulSet + static PV (hostPath `/data/postgresql`, class `manual`); migration Job; daily `pg_dumpall` CronJob + weekly cleaner; netpol allows `app: back`, `app: auth`, `app: migration` |
| redis-cache | `redis` | redis:4.0.11-alpine | redis-cache-clusterip 6379 | config from `redis-cache-configmap` (redis.conf: bind all, dir /data/redis, AOF); netpol allows `app: back` only |
| load-generator | `loadGenerator` | busybox:1.28 | — | 20 replicas hammering nodejs `/fibonacci`; default off (`loadGenerator.enable`) |
| kube-prometheus-stack | `metrics` | — | `<release>-prometheus` :9090, `<release>-grafana` :80 | default off (`metrics.enabled`); ingress hosts prom.test / grafana.test |

Ingress (`<release>-ingress`, class nginx, regex + rewrite `/$1`): `grogu.test/` → front, `grogu.test/api/?(.*)` → gateway, `auth.test` → Keycloak, `prom.test`/`grafana.test` → metrics stack.

Startup ordering: nodejs/golang Deployments have init containers (`templates/_helpers.yaml`) that block until Postgres accepts `psql` and Redis answers PING; KrakenD readiness probes nodejs. Keycloak waits for Postgres via the same helper.

## Conventions & gotchas

- **Release name `ap` is load-bearing**: the ingress references `<release>-kube-prometheus-stack-prometheus` and `<release>-grafana`. Don't rename the release without checking `templates/ingress.yaml`.
- Values keys: `loadGenerator.enable` (not `enabled`), `metrics.enabled`. Toggle at deploy time with `--set` (see `./start --metrics`).
- Secrets: `database.*` and `keycloak.*` exist ONLY in `secrets.yaml` (SOPS). The chart does not render without them — use `helm secrets ...` or pass `--set database.name=... keycloak.adminName=...` for throwaway renders.
- The demo GPG key + passphrase are committed intentionally (pet/demo project). For anything real, replace the key and `.sops.yaml` recipient.
- `helm dependency update` is unnecessary for day-to-day work — the subchart tgz is vendored in `helm-chart/charts/`.
- App images come from Docker Hub (`mmko67/*`) — rebuilding a service means `docker build && docker push`, then bumping `version:` in `values.yaml`.
- The react image has Keycloak URLs baked in at build time (`VITE_*` build args in its Dockerfile, defaults reproduce `*.test`); the env vars in the deployment template don't change the built SPA. New app host ⇒ `scripts/build-front.sh <tag>` + `front.version` bump.
- Browser-facing URLs (Keycloak redirect URIs, KrakenD CORS, react env) all follow `.Values.host.scheme://.Values.host.app|auth` — change hosts and scheme together; `tls.enabled=true` requires `tls.email` (chart refuses to render otherwise) and cert-manager pre-installed (ansible role `cert_manager`).
- Remote deploys (lan/vps) are GitOps: ArgoCD renders the chart with the helm-secrets CMP sidecar (`ansible/roles/argocd/templates/repo-server-helm-secrets.yaml.j2`) using the committed demo GPG key; the SOPS key lives in Secret `argocd-sops-gpg` in namespace `argocd`. Bump its pinned tool versions together with `ansible/group_vars/all.yml`.
- Remote k8s API access goes through an ssh tunnel (`127.0.0.1:16443 → target:6443`) — 6443 is firewalled on targets by the `common` role (ufw allows only 22/80/443).
- Postgres/Redis PVs are node-pinned (hostPath / static, class `manual`) — fine on single-node Minikube, single-node k3s (lan/vps) and anything else 1-node; must be replaced for multi-node.

## Known issues (left as-is on purpose; fix in "phase 2 — chart hardening")

- Redis is a Deployment (README TODO: StatefulSet); single replica everything.
- Keycloak runs in `start-dev` mode (dev-only, HTTP, embedded config) — acceptable locally, not for prod.
- golang-back: no metrics, no HPA, no netpol distinctions beyond `app: back`; `/numbers/` (trailing slash) vs nodejs `/numbers` differ.
- Load generator hits nodejs only; cron schedules `@daily`/`@weekly` with no concurrencyPolicy tuning.
- `grogu-namespace.yaml` creates namespace `default-namespace` that nothing uses; workloads all go to `default` via `.Values.namespace`.
- ServiceMonitor namespace hardcoded to `default` (the template itself is gated on `metrics.enabled`).
- Old image tags (redis 4.0.11 from 2018, postgres 14.0, keycloak 25.0.6); krakend metrics port 9090 not declared as containerPort (works, just undeclared).
- react-front has limits only (requests default to limits); the react image's Keycloak URLs are baked at build time.
- Remote hosts run Keycloak `start-dev` too, and the ArgoCD SOPS path uses the committed demo PGP key (works, but swap to age + untracked key before anything real).

## Launch-critical fixes already applied (don't undo)

- `redis-cache-configmap` carries a real `redis.conf` (bind all / `dir /data/redis` / AOF) — without it Redis crashloops and both backends hang on init containers.
- Postgres PV hostPath uses `type: DirectoryOrCreate` — without it a fresh node can't mount `/data/postgresql`.
- Backends carry distinct `stack: nodejs|golang` labels and the Services select on them — both used to share `app: back`, so each Service targeted BOTH Deployments and ~half of all gateway calls hit a pod that wasn't listening.
- Keycloak uses `KC_DB*` env (the legacy `DB_*` vars are ignored by Keycloak 25) + waits for Postgres + postgres netpol allows `app: auth` — Keycloak now actually persists to Postgres instead of silently running on in-memory H2.
- `nodejs-back-service-monitor` and the prom/grafana ingress rules render only when `metrics.enabled=true` — referencing CRDs/services that don't exist breaks the chart install and the ingress-nginx config sync.
- The realm import seeds user `demo` from `values.yaml auth.seedUser`; `reactclient` has Direct Access Grants ON, which is what the smoke tests use.
- Load generator has a single `replicas:` key (there was a duplicate).
- Postgres has readiness/liveness probes (`pg_isready`) + requests/limits, Redis has `redis-cli ping` probes — the `common` ansible role never enables ufw before the SSH rule exists (no lockout).
- `ingress.yaml` TLS block + `cert-manager.io/cluster-issuer` annotation are gated on `tls.enabled`; defaults render exactly as before TLS support was added (verified against a stored baseline render).

## Verification workflow for changes

1. `helm lint ./helm-chart` — expect one pre-existing ERROR about `.Values.database.name` (secrets live only in secrets.yaml); anything else is yours.
2. Render check: `helm template ap ./helm-chart --set database.name=x --set database.user=x --set database.password=x --set keycloak.adminName=admin --set keycloak.adminPassword=admin`. For TLS/overlay work also render with `-f helm-chart/values-lan.yaml` (must equal the defaults render) and `-f helm-chart/values-vps.yaml --set tls.email=t@e.st` (must contain the ClusterIssuer + TLS block).
3. Remote plumbing: `bash -n scripts/*.sh`; if ansible is installed, `ansible-playbook -i ansible/inventory.sample.ini ansible/site.yml --syntax-check`.
4. Real check: `make upgrade` (or `./start`) and watch `make status` until pods are Ready; the smoke tests cover front/gateway/public+private APIs. Remote targets: `./start lan|vps` (needs `ansible/inventory.ini`), same smoke suite runs automatically.
