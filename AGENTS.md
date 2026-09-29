# AGENTS.md — guide for coding agents working in this repo

Pet project: a full-stack demo app deployed to Kubernetes through one Helm chart, run locally on Minikube. Authored ~2024, revived 2026. Everything deployable lives in `helm-chart/`; the application source lives next to it in this repo.

## Entry points

| Command | What it does |
|---|---|
| `./start` | **The one command.** Idempotent: minikube + addons → `/etc/hosts` → SOPS/GPG setup → `helm secrets upgrade --install ap` → wait Ready → `minikube tunnel` → automated E2E smoke tests (incl. JWT-authenticated private endpoints). Flags: `--metrics`, `--load-generator`, `--skip-smoke`, `--check-only`. |
| `./stop` | `helm uninstall ap` + stop tunnel; `--purge` also deletes the minikube cluster. |
| `make status` | cluster / pods / release / tunnel / URL health. |
| `make upgrade` | re-deploy chart after changes (helm upgrade --install). |
| `make secrets-edit` | edit SOPS-encrypted `secrets.yaml`. |
| `scripts/local-up.sh`, `scripts/local-down.sh`, `scripts/status.sh` | what `./start`, `./stop`, `make status` call — read these before changing launch behavior. |

Docs: `docs/ARCHITECTURE.md` (topology, flows, known issues), `readme.md` (user-facing).

## Repo map

```
helm-chart/                  the single umbrella chart ("bona-helm", release name "ap")
  Chart.yaml                 dependency: kube-prometheus-stack 65.3.2, condition metrics.enabled (vendored in charts/)
  values.yaml                all config; secrets come only from secrets.yaml
  secrets.yaml (root)        SOPS+PGP encrypted: database.{name,user,password}, keycloak.{adminName,adminPassword}
  .sops.yaml  demo-secret-key.asc   SOPS config + demo PGP private key (passphrase: example1) — public on purpose
  config/krakend.json        gateway config (Go-templated)
  config/realm-export.json   Keycloak realm import (Go-templated; seeds user demo/demo via .Values.auth.seedUser)
  migrations/migration-1.sql creates + seeds nodejs_numbers (3087), golang_numbers (1703); runs via a k8s Job
  templates/                 one folder per component (see below)
nodejs-back/                 Node 22 + express API (Dockerfile: distroless)
golang-back/                 Go 1.21 + gin API (Dockerfile; needs .env locally — godotenv log.Fatal — but NOT in cluster)
react-front/                 React 18 + TS + Vite SPA
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
- The react image has Keycloak URLs baked in at build time (`VITE_*` in its Dockerfile); the env vars in the deployment template don't change the built SPA.
- Postgres/Redis PVs are node-pinned (hostPath / static, class `manual`) — fine on single-node Minikube, must be replaced for multi-node or VPS.

## Known issues (left as-is on purpose; fix in "phase 2 — chart hardening")

- Redis is a Deployment (README TODO: StatefulSet); single replica everything; Postgres has no probes/resources.
- Keycloak runs in `start-dev` mode (dev-only, HTTP, embedded config) — acceptable locally, not for prod.
- golang-back: no metrics, no HPA, no netpol distinctions beyond `app: back`; `/numbers/` (trailing slash) vs nodejs `/numbers` differ.
- Load generator hits nodejs only; cron schedules `@daily`/`@weekly` with no concurrencyPolicy tuning.
- `grogu-namespace.yaml` creates namespace `default-namespace` that nothing uses; workloads all go to `default` via `.Values.namespace`.
- ServiceMonitor namespace hardcoded to `default` (the template itself is gated on `metrics.enabled`).
- Old image tags (redis 4.0.11 from 2018, postgres 14.0, keycloak 25.0.6); krakend metrics port 9090 not declared as containerPort (works, just undeclared).
- react-front has limits only (requests default to limits); the react image's Keycloak URLs are baked at build time.

## Launch-critical fixes already applied (don't undo)

- `redis-cache-configmap` carries a real `redis.conf` (bind all / `dir /data/redis` / AOF) — without it Redis crashloops and both backends hang on init containers.
- Postgres PV hostPath uses `type: DirectoryOrCreate` — without it a fresh node can't mount `/data/postgresql`.
- Backends carry distinct `stack: nodejs|golang` labels and the Services select on them — both used to share `app: back`, so each Service targeted BOTH Deployments and ~half of all gateway calls hit a pod that wasn't listening.
- Keycloak uses `KC_DB*` env (the legacy `DB_*` vars are ignored by Keycloak 25) + waits for Postgres + postgres netpol allows `app: auth` — Keycloak now actually persists to Postgres instead of silently running on in-memory H2.
- `nodejs-back-service-monitor` and the prom/grafana ingress rules render only when `metrics.enabled=true` — referencing CRDs/services that don't exist breaks the chart install and the ingress-nginx config sync.
- The realm import seeds user `demo` from `values.yaml auth.seedUser`; `reactclient` has Direct Access Grants ON, which is what the smoke tests use.
- Load generator has a single `replicas:` key (there was a duplicate).

## Verification workflow for changes

1. `helm lint ./helm-chart` — expect one pre-existing ERROR about `.Values.database.name` (secrets live only in secrets.yaml); anything else is yours.
2. Render check: `helm template ap ./helm-chart --set database.name=x --set database.user=x --set database.password=x --set keycloak.adminName=admin --set keycloak.adminPassword=admin`.
3. Real check: `make upgrade` (or `./start`) and watch `make status` until pods are Ready; the `./start` smoke tests cover front/gateway/public+private APIs.
