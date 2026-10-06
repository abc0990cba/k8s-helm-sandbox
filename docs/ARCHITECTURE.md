# Architecture

Visual description of what `./start` deploys. Component sources live in this repo (`nodejs-back/`, `golang-back/`, `rust-back/`, `react-front/`); everything else is defined in `helm-chart/`.

The demo is **database-per-service polyglot**: three backends, three persistence engines, and one asynchronous analytics pipeline tying them together.

| Domain | Backend | Database | Why this pair is interesting |
|---|---|---|---|
| notes + numbers/fibonacci/primes | golang-back (Go 1.25 + gin) | PostgreSQL 17.6 | classic relational CRUD, `/metrics` via promhttp |
| link shortener + async jobs + numbers | nodejs-back (Node 22 + express) | **libSQL server** (SQLite-wire, MIT, ~100MB) | server-mode SQLite, FTS5 full-text search, `@libsql/client` |
| click analytics | rust-back (axum + tokio) | **DuckDB** (embedded OLAP, MIT, in-process) | columnar aggregations over a stream-fed event table on a PVC |
| shared infra | — | Redis 7.4 | two streams (`jobs`, `clicks`) + read-through caches |

## Component topology

```mermaid
flowchart LR
    subgraph cluster["Minikube cluster (docker driver, Calico CNI)"]
        direction TB
        ingress["ingress-nginx<br/>(minikube addon + tunnel → 127.0.0.1)"]

        subgraph ns["namespace: default"]
            front["react-front<br/>React 19 + Mantine 9 SPA<br/>:9071→8080"]
            gateway["krakend-gateway x2<br/>API gateway, JWT at the edge<br/>:8787→8080"]
            nodejs["nodejs-back<br/>Node 22 + express<br/>links · jobs · HPA 1-10"]
            worker["nodejs-worker<br/>jobs stream consumer"]
            golang["golang-back<br/>Go 1.25 + gin<br/>notes · numbers"]
            rust["rust-back<br/>axum + DuckDB<br/>analytics · HPA 1-3"]
            keycloak["keycloak-auth<br/>Keycloak 26.8 (production start)<br/>:8080 · mgmt :9000"]
            postgres[("postgres 17.6<br/>StatefulSet + hostPath PV<br/>:5432")]
            libsql[("libSQL (sqld)<br/>StatefulSet + PVC<br/>:8080")]
            redis[("redis-cache 7.4<br/>AOF on PVC · 2 streams<br/>:6379")]
            duckdb[("DuckDB file<br/>rust-back PVC<br/>/data/clicks.duckdb")]
            migrations["migration Jobs<br/>postgres (SQL files) · libsql (ConfigMap SQL)"]
            backup["backup CronJobs<br/>pg_dumpall @daily · cleaner @weekly · SQL report @daily"]
            loadgen["load-generator x20<br/>(optional, --load-generator)"]
            prom["kube-prometheus-stack<br/>(optional, --metrics)"]
        end
    end

    browser["Browser<br/>*.test → 127.0.0.1"]

    browser -->|"grogu.test/"| ingress --> front
    front -->|"keycloak-js PKCE"| keycloak
    browser -->|"grogu.test/api/*"| ingress --> gateway
    gateway -->|"/v1/golang/*"| golang
    gateway -->|"/v1/nodejs/*"| nodejs
    gateway -->|"/v1/rust/*"| rust
    gateway -->|"JWT via JWKS"| keycloak
    golang --> postgres
    golang --> redis
    nodejs --> libsql
    nodejs -->|XADD clicks + XADD jobs| redis
    worker -->|XREADGROUP jobs| redis
    worker --> libsql
    rust -->|XREADGROUP clicks| redis
    rust --- duckdb
    keycloak --> postgres
    migrations --> postgres
    migrations --> libsql
    backup --> postgres
    loadgen --> nodejs
    prom -.->|scrape /metrics| nodejs
    prom -.->|scrape /metrics| rust
```

## Request flows

Authentication is unchanged: KrakenD `auth/validator` (RS256) validates `Authorization: Bearer` against Keycloak's JWKS on every **write** and on `/v1/*/private`. Reads are public.

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant G as KrakenD
    participant N as nodejs-back
    participant L as libSQL
    participant R as Redis (clicks stream)
    participant RS as rust-back
    participant D as DuckDB

    B->>G: POST /api/v1/nodejs/links {url}
    G->>G: JWT validated (auth/validator)
    G->>N: POST /links
    N->>L: INSERT INTO links (code, url, …)
    N-->>B: 201 {code, url}

    B->>G: GET /api/v1/nodejs/links/{code}
    G->>N: GET /links/{code}
    N->>R: XADD clicks {code, referrer, ts}
    N-->>B: 200 {url} (60s redis cache)
    B->>B: window.open(url)

    RS->>R: XREADGROUP analytics (BLOCK 5s)
    RS->>D: INSERT OR IGNORE (entry_id = dedupe key)
    RS->>R: XACK

    B->>G: GET /api/v1/rust/analytics/links/{code}
    G->>RS: GET /analytics/links/{code}
    RS->>D: GROUP BY day / referrer
    RS-->>B: {total_clicks, per_day, top_referrers}
```

Gateway endpoints (from `helm-chart/config/krakend.json`): `/healthz`, notes `/v1/golang/notes*` (CRUD), links `/v1/nodejs/links*` (list/create/click/delete), jobs `/v1/nodejs/jobs*`, analytics `/v1/rust/analytics/{summary,top,links/{code}}`, playground `/v1/{nodejs,golang}/{public,private}`, CPU demos `/v1/nodejs/fibonacci`, `/v1/golang/public/fibonacci/{num}`, `/v1/golang/public/primes/{num}`. All writes + `*/private` require a valid `reactclient` JWT (Direct Access Grants enabled, so `grant_type=password` works — that is what the smoke tests use). Everything is `no-op` passthrough: backend statuses (401/404/204) reach the browser verbatim.

## Data & persistence (database-per-service)

- **PostgreSQL** — owned by **golang-back**: `notes`, `golang_numbers`, `daily_reports` (nightly pure-SQL CronJob). StatefulSet + static hostPath PV (`/data/postgresql`, class `manual`). Credentials from the SOPS `postgres-secret`. NetworkPolicy: only golang, keycloak and `app: migration` (migration Job + backup/report CronJobs) may connect.
- **libSQL (sqld)** — owned by **nodejs-back** (+ its worker): `links` (+ FTS5 index), `jobs`, `numbers`. StatefulSet (`SQLD_NODE=standalone`) with a PVC via volumeClaimTemplates; the image wrapper chowns the data dir and drops to the `sqld` user. Schema rides the **chart** in `helm-chart/migrations-libsql/` → ConfigMap → version-suffixed Job running the nodejs image's `scripts/migrate.js`. No auth on the HTTP interface on purpose — the NetworkPolicy admits only the nodejs backend, the worker and the migration Job.
- **DuckDB** — owned by **rust-back**: a single `clicks.duckdb` file on its own PVC, written by the same process that serves the API (single-writer by construction). At-least-once stream delivery is deduped by the redis entry id (PRIMARY KEY). `fsGroup: 65532` gives the distroless user ownership of the mount.
- **Redis** — shared infrastructure, not a system of record: `jobs` stream (nodejs producer → worker consumer group), `clicks` stream (nodejs producer → rust consumer group), read-through caches (`link:<code>` TTL 60s, fibonacci numbers for golang).

## Auth model

- Realm `demorealm` is imported from `config/realm-export.json` (rendered through Helm `tpl`, so the demo user comes from `values.yaml auth.seedUser`). Import happens only when the realm doesn't exist yet — changes made in the Keycloak UI persist in Postgres.
- Client `reactclient` — public client, redirect `http://grogu.test/`, web origin `http://grogu.test`, Direct Access Grants ON.
- Keycloak runs production `start` (26.8) with health/metrics on the management port 9000; `auth.devMode: true` is the instant rollback to `start-dev`.
- The SPA (React 19 + keycloak-js PKCE) refreshes tokens 60s before expiry; the axios interceptor attaches the token, KrakenD verifies the RS256 signature at the edge.

## Startup order (why pods wait)

```mermaid
flowchart TD
    P[postgres] --> MJ[postgres migration Job] --> R[redis-cache]
    L[libSQL] --> LJ[libsql migration Job]
    L --> NI[nodejs init: wait-for-libsql + wait-for-redis]
    P --> KI[keycloak init: wait-for-postgres] --> KC[keycloak]
    P --> GI[golang init: wait-for-postgres + wait-for-redis]
    R --> RI[rust init: wait-for-redis]
    R --> NI
    NI --> NB[nodejs-back + worker]
    GI --> GB[golang-back]
    RI --> RB[rust-back]
    NB --> KR[krakend readiness: /v1/nodejs/public]
```

Init container definitions live in `helm-chart/templates/_helpers.yaml`. Until Redis is answerable, the backends stay in `Init:0/2` — a stuck init container almost always means libSQL, Postgres or Redis is not up.

## Deployment toggles

| Toggle | Default | Effect |
|---|---|---|
| `metrics.enabled` | false | installs kube-prometheus-stack (vendored subchart); adds prom.test / grafana.test behind the ingress + 5 ServiceMonitors (nodejs, golang, rust, krakend :9090, keycloak :9000) + the analytics pipeline dashboard |
| `loadGenerator.enable` | false | 20 busybox pods hammering nodejs `/fibonacci`, golang fibonacci through the gateway AND `/v1/nodejs/links/demo001` — that last one makes the click-analytics charts move under load |

## Known issues / shortcuts (accepted for the local pet project)

After the 2026-10 database-per-service split:

1. Everything is single-replica (postgres, redis, keycloak, libsql, rust-back); the PDBs and zero-downtime strategies matter only once that changes. DuckDB additionally requires the single-replica rust-back (one file, one writer).
2. Postgres PV is hostPath (`DirectoryOrCreate`, class `manual`) and the `pg_dumpall` backups land on the same volume — node loss loses data AND backups; no restore automation (roadmap: MinIO offsite backups). libSQL/DuckDB data live on PVCs (node-pinned local-path), same single-node story.
3. libSQL accepts unauthenticated HTTP connections — guarded only by the NetworkPolicy. Fine inside the demo namespace; swap in JWT/basic auth before anything real.
4. SOPS still uses the committed demo PGP key (swap to age + untracked key before anything real).
5. `VITE_*` env in the chart stay no-ops — Keycloak URLs are baked into the published image (orbstack's CI build uses the `*.test` defaults).
6. JS/Go/Rust dependency audit findings are not triaged (mostly transitive/dev-time).
7. Metrics on orbstack fit an 8 GB machine only because the kube-prometheus-stack block trims the subchart (no alertmanager/webhooks/k3s-embedded targets, 2h retention) and because the new stores are deliberately tiny (libSQL ~100MB, DuckDB in-process).
