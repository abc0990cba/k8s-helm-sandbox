# Architecture

Visual description of what `./start` deploys. Component sources live in this repo (`nodejs-back/`, `golang-back/`, `react-front/`); everything else is defined in `helm-chart/`.

## Component topology

```mermaid
flowchart LR
    subgraph cluster["Minikube cluster (docker driver, Calico CNI)"]
        direction TB
        ingress["ingress-nginx<br/>(minikube addon + tunnel → 127.0.0.1)"]

        subgraph ns["namespace: default"]
            front["react-front<br/>React 18 + Vite SPA<br/>:9071→8080"]
            gateway["krakend-gateway x2<br/>API gateway<br/>:8787→8080"]
            nodejs["nodejs-back<br/>Node 22 + express<br/>:9070→8080 · HPA 1-10"]
            golang["golang-back<br/>Go 1.21 + gin<br/>:8800→8081"]
            keycloak["keycloak-auth<br/>Keycloak 25 (start-dev)<br/>:8080"]
            postgres[("postgres 14<br/>StatefulSet + PVC<br/>:5432")]
            redis[("redis-cache 4<br/>AOF on PVC<br/>:6379")]
            migration["postgres-migration Job<br/>(seeds 3087 / 1703)"]
            backup["backup CronJobs<br/>pg_dumpall @daily · cleaner @weekly"]
            loadgen["load-generator x20<br/>(optional, --load-generator)"]
            prom["kube-prometheus-stack<br/>(optional, --metrics)"]
        end
    end

    browser["Browser<br/>*.test → 127.0.0.1"]

    browser -->|"grogu.test/"| ingress --> front
    front -->|"keycloak-js login"| keycloak
    browser -->|"grogu.test/api/*"| ingress --> gateway
    gateway -->|"/v1/nodejs/*"| nodejs
    gateway -->|"/v1/golang/*"| golang
    gateway -->|"JWT via JWKS"| keycloak
    nodejs --> postgres
    nodejs --> redis
    golang --> postgres
    golang --> redis
    keycloak --> postgres
    migration --> postgres
    backup --> postgres
    loadgen --> nodejs
    prom -.->|scrape /metrics| nodejs
```

## Request flow

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant I as ingress-nginx
    participant F as react-front
    participant K as Keycloak
    participant G as KrakenD
    participant N as nodejs-back
    participant Go as golang-back

    B->>I: GET grogu.test/
    I->>F: (path /)
    F->>K: keycloak-js authorize (realm demorealm, client reactclient)
    K-->>F: JWT (RS256)
    B->>I: GET grogu.test/api/v1/nodejs/private<br/>Authorization: Bearer <JWT>
    I->>G: /v1/nodejs/private (rewrite /api/?(.*) → /$1)
    G->>K: fetch JWKS (keycloak-auth-clusterip:8080)
    G->>N: GET /numbers (JWT validated by KrakenD auth/validator)
    N-->>B: {"data": [...]} via G
    B->>I: GET grogu.test/api/v1/golang/public/fibonacci/10
    I->>G: /v1/golang/public/fibonacci/10
    G->>Go: GET /fibonacci/10 (no auth on /public)
    Go-->>B: fib result via G
```

Gateway endpoints (from `helm-chart/config/krakend.json`): `/healthz`, `/v1/nodejs/{public,private,fibonacci}`, `/v1/golang/{public,private}`, `/v1/golang/public/fibonacci/{num}`, `/v1/golang/public/primes/{num}`. `/v1/*/private` require a valid `reactclient` JWT (Direct Access Grants enabled, so `grant_type=password` works too — this is what the `./start` smoke tests use).

## Data & persistence

- **Postgres** — StatefulSet with static PV (hostPath `/data/postgresql`, storageClass `manual`, survives pod restarts, dies with `./stop --purge`). Credentials from the SOPS-encrypted `postgres-secret` (`database.*` in `secrets.yaml`). NetworkPolicy: only `app: back` (both backends), `app: auth` (Keycloak) and `app: migration` (migration Job + backup CronJobs) may connect; egress denied.
- **Migrations** — `postgres-migration-1-job` runs `migrations/migration-1.sql`: creates `nodejs_numbers` / `golang_numbers` and seeds rows **3087** and **1703**. Helm Job semantics: runs on install, not re-run on upgrade (delete it first if you edit the SQL: `kubectl delete job postgres-migration-1-job`).
- **Redis** — Deployment with PVC at `/data/redis`, config from `redis-cache-configmap` (AOF enabled). NetworkPolicy: only `app: back` may connect. Both backends cache here (`REDIS_HOST`/`REDIS_PORT` are baked into `postgres-secret`).

## Auth model

- Realm `demorealm` is imported from `config/realm-export.json` (rendered through Helm `tpl`, so the demo user comes from `values.yaml auth.seedUser`). Import happens only when the realm doesn't exist yet — changes made in the Keycloak UI persist in Postgres.
- Client `reactclient` — public client, redirect `http://grogu.test/`, web origin `http://grogu.test`, Direct Access Grants ON.
- KrakenD `auth/validator` (RS256) fetches public keys from `http://keycloak-auth-clusterip:8080/realms/demorealm/protocol/openid-connect/certs` and validates the `Authorization: Bearer` on `/v1/*/private`.

## Startup order (why pods wait)

```mermaid
flowchart TD
    P[postgres] --> MJ[migration Job] --> R[redis-cache]
    P --> KI[keycloak init: wait-for-postgres] --> KC[keycloak]
    P --> NI[nodejs/golang init: wait-for-postgres + wait-for-redis]
    R --> NI
    NI --> NB[nodejs-back + golang-back]
    NB --> KR[krakend readiness: /v1/nodejs/public]
```

Init container definitions live in `helm-chart/templates/_helpers.yaml`. Until Redis is answerable, both backends stay in `Init:0/2` — a stuck init container almost always means Postgres or Redis is not up.

## Deployment toggles

| Toggle | Default | Effect |
|---|---|---|
| `metrics.enabled` | false | installs kube-prometheus-stack (vendored subchart); adds prom.test / grafana.stack behind the ingress |
| `loadGenerator.enable` | false | 20 busybox pods hammering nodejs `/fibonacci` to demo the HPA |

## Known issues / shortcuts (accepted for the local pet project)

After the 2026-10 production-pattern pass, the list shrank to:

1. Everything is single-replica (postgres, redis, keycloak, backends); the PDBs and zero-downtime strategies matter only once that changes.
2. Postgres PV is hostPath (`DirectoryOrCreate`, class `manual`) and the `pg_dumpall` backups land on the same volume — node loss loses data AND backups; no restore automation.
3. SOPS still uses the committed demo PGP key (swap to age + untracked key before anything real).
4. `VITE_*` env in the chart stay no-ops — Keycloak URLs are baked into the published image (orbstack's CI build uses the `*.test` defaults).
5. JS/Go dependency audit findings are not triaged (mostly transitive/dev-time).
6. Metrics on orbstack fit an 8 GB machine only because the kube-prometheus-stack block trims the subchart (no alertmanager/webhooks/k3s-embedded targets, 2h retention).

Already fixed in that pass (was on this list before): Redis → StatefulSet, Keycloak production mode (26.8, `--health/--metrics` on :9000; `auth.devMode` rollback), golang `/metrics` + HPA + ServiceMonitor, PDBs + NetworkPolicies + securityContext everywhere, image bumps (redis 7.4, postgres 17.6, keycloak 26.8, krakend 2.9.4), unused namespace file removed, ServiceMonitor namespace/selector bugs.
