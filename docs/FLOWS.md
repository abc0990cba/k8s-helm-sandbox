# FLOWS — sequence diagrams of the running code

Every diagram maps 1:1 to the current sources (v2 polyglot split). Read
[ARCHITECTURE.md](ARCHITECTURE.md) first for the component topology; this
file is the request-level view.

## 1. Authentication — login + the first private call

Keycloak issues the tokens; the SPA never stores them outside keycloak-js;
the gateway is the only verification point.

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser (React 19 + Mantine)
    participant K as Keycloak (realm demorealm)
    participant G as KrakenD gateway
    participant N as nodejs-back

    B->>K: keycloak-js login (PKCE, client reactclient)
    K-->>B: authorization code → tokens (RS256, 5 min TTL)
    Note over B: onTokenExpired → updateToken(60s before expiry)
    B->>G: GET /api/v1/nodejs/private · Authorization: Bearer <jwt>
    G->>K: fetch JWKS (keycloak-auth-clusterip/realms/demorealm/certs)
    G->>G: auth/validator: RS256 signature + exp
    alt valid token
        G->>N: GET /numbers (Authorization forwarded)
        N-->>B: 200 {"data":[…]} (via gateway, mapping applied)
    else missing/expired
        G-->>B: 401 (krakend answers, no backend involved)
    end
```

## 2. Notes — the golang/postgres domain

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant G as KrakenD
    participant Go as golang-back
    participant P as PostgreSQL

    B->>G: GET /api/v1/golang/notes?limit=5&offset=0
    G->>Go: GET /notes/
    Go->>P: SELECT … FROM notes ORDER BY created_at LIMIT/OFFSET
    Go-->>B: {items, total, limit, offset}

    B->>G: POST /api/v1/golang/notes {title, body} + JWT
    G->>G: JWT validated (write = always private)
    G->>Go: POST /notes/
    Go->>Go: owner = JWT payload.preferred_username (base64 decode)
    Go->>P: INSERT INTO notes(title, body, owner)
    Go-->>B: 201 note

    B->>G: PATCH /notes/{id} · DELETE /notes/{id}
    Go->>P: UPDATE … COALESCE / DELETE
    Go-->>B: 200 / 204 → 404 after delete
```

## 3. Links + click analytics — the three-database pipeline

The flagship flow: a click is written by nodejs, transported by redis,
landed by rust, and read back as DuckDB aggregations. No synchronous
coupling anywhere.

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant G as KrakenD
    participant N as nodejs-back
    participant L as libSQL (links + FTS5)
    participant R as Redis (clicks stream)
    participant RS as rust-back (consumer + API)
    participant D as DuckDB (PVC)

    rect rgb(30, 60, 30)
    Note over B,L: create (JWT-validated at the gateway)
    B->>G: POST /api/v1/nodejs/links {url, title}
    G->>N: POST /links
    N->>L: INSERT INTO links(code, url, title, created_by)
    N-->>B: 201 {code: "a7Xb2K9", url, …}
    end

    rect rgb(60, 40, 10)
    Note over B,R: the click (public by design — resolving IS a click)
    B->>G: GET /api/v1/nodejs/links/a7Xb2K9
    G->>N: GET /links/a7Xb2K9
    N->>R: cache hit? (link:a7Xb2K9, TTL 60s)
    N->>L: cache miss → SELECT
    N->>R: XADD clicks * {code, referrer, ts}
    N-->>B: 200 {url} → browser opens the target
    end

    rect rgb(10, 40, 60)
    Note over RS,D: async landing (at-least-once, deduped)
    RS->>R: XREADGROUP analytics BLOCK 5000
    R-->>RS: entry 1234-1 {code, referrer, ts}
    RS->>D: INSERT OR IGNORE (entry_id = PK → replay-safe)
    RS->>R: XACK 1234-1
    end

    rect rgb(50, 20, 50)
    Note over B,D: read back as aggregations
    B->>G: GET /api/v1/rust/analytics/links/a7Xb2K9
    G->>RS: GET /analytics/links/a7Xb2K9
    RS->>D: count(*), GROUP BY epoch-day, GROUP BY referrer
    D-->>RS: rows
    RS-->>B: {total_clicks, per_day, top_referrers} → charts
    end
```

Delivery guarantees: redis streams are at-least-once — a consumer crash
between insert and XACK redelivers the entry; the stream entry id is the
DuckDB PRIMARY KEY, so replays are `INSERT OR IGNORE` no-ops. Consumer
group `analytics` keeps offsets per-service (a second analytics service
could replay the whole stream from `$` or `0`).

## 4. Async jobs — API and worker as separate deployments

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant G as KrakenD
    participant N as nodejs-back (API pods)
    participant R as Redis (jobs stream)
    participant W as nodejs-worker (consumer group "workers")
    participant L as libSQL (jobs table)

    B->>G: POST /api/v1/nodejs/jobs {type:"fibonacci", payload:{n:10}} + JWT
    G->>N: POST /jobs
    N->>L: INSERT INTO jobs(id, type, payload, status='queued')
    N->>R: XADD jobs * {id, type}
    N-->>B: 202 {id, status:"queued"} — returns immediately

    W->>R: XREADGROUP workers BLOCK 5000
    R-->>W: {id, type}
    W->>L: UPDATE status='processing'
    W->>W: BigInt fib(10) → "55"
    W->>L: UPDATE status='done', result
    W->>R: XACK

    loop every 1.5s until terminal (TanStack Query refetchInterval)
        B->>G: GET /api/v1/nodejs/jobs/{id}
        G->>N: GET /jobs/{id}
        N->>L: SELECT … WHERE id
        N-->>B: {status, result}
    end
```

Job types: `fibonacci` (CPU demo, drives the HPA story) and `wordcount`
(carries its own `payload.text` — no cross-database reads: notes belong to
golang's postgres now).

## 5. Deploy — from `git push` to running pods (orbstack shape)

```mermaid
sequenceDiagram
    autonumber
    participant Dev as Developer
    participant Gi as Gitea (source of truth)
    participant CI as Gitea Actions (act_runner)
    participant Reg as in-machine registry :30500
    participant Br as bare repo (gitops-origin :9418)
    participant A as ArgoCD
    participant K as k3s

    Dev->>Gi: git push (app code / chart)
    Gi->>CI: trigger build-deploy
    CI->>CI: helm render matrix (defaults, lan==defaults, orbstack, vps+tls)
    CI->>CI: per-service tests (node:22 / golang:1.25 / rust:1 / node:22)
    CI->>Reg: docker build + push image:$SHA (changed services only)
    CI->>Gi: commit "ci: images for $SHA" (awk block-bump values-orbstack.yaml)
    CI->>Br: mirror main
    A->>Br: poll (3 min) → diff vs cluster
    A->>K: helm template (CMP sidecar decrypts SOPS, --include-crds) → apply/sync
    K->>K: migration Jobs run (version-suffixed names) → rollout → probes
    A-->>Dev: app ap: Healthy/Synced
    Note over Dev,K: ./start orbstack --skip-bootstrap then runs the smoke suite
```

The local minikube path skips CI/ArgoCD: `./start` renders the same chart
with `helm secrets upgrade --install` directly.

## 6. Progressive delivery (roadmap toggle) — canary for rust-back

Active when `rustBack.rollout.enabled: true` (Argo Rollouts controller
installed via the ansible role) — see ARCHITECTURE.md "Deployment toggles".

```mermaid
sequenceDiagram
    autonumber
    participant A as ArgoCD
    participant RO as Argo Rollouts
    participant RS as rust-back replicas
    participant P as Prometheus

    A->>RO: apply Rollout (new image)
    RO->>RS: scale canary RS to 25% (replica-ratio split, same Service)
    RO->>RO: pause 1m
    RO->>RS: 50%
    RO->>RO: pause 2m
    RO->>P: AnalysisTemplate: stream errors ↑? crashloops ↑?
    P-->>RO: successCondition met (errors ≤ 1, restarts ≤ 1)
    RO->>RS: 100% — stable RS drained
    Note over RO: analysis failure → automatic rollback to the previous ReplicaSet
```

## 7. Chaos experiments (roadmap toggle)

Applied by hand from [CHAOS.md](CHAOS.md) + `docs/chaos/*.yaml`; every
experiment has an expected outcome tied to a hardening mechanism (PDB,
readiness, init containers, HPA). Nothing here runs automatically.
