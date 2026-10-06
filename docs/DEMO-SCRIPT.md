# DEMO-SCRIPT — the video narrative (5–8 minutes)

A shot-by-shot script for recording the demo video. Every step is something the
stack actually does; run `./start` (or `./start orbstack --skip-bootstrap`)
first and let the smoke suite go green before hitting record. The UI tour is
strongest in **dark mode** (toggle in the header).

## 1. The one-liner (30s)

Terminal, full view:

- `./start` — show the script output marching through: minikube → hosts →
  SOPS → helm upgrade → pods Ready → **smoke suite going green one line at a
  time** (the links→analytics line is the money shot: a click just crossed
  two service boundaries asynchronously before the suite even finished).

Talking point: "One command deploys a four-service polyglot app to Kubernetes
through one Helm chart, and the smoke suite proves the whole story works."

## 2. The architecture slide (30s)

Open [docs/ARCHITECTURE.md](./ARCHITECTURE.md) and show the topology diagram.

Talking points:

- three backends, each with its **own** database: golang→PostgreSQL,
  nodejs→libSQL, rust→DuckDB (database-per-service — no shared tables, no
  cross-service DB credentials, enforced by NetworkPolicies);
- the async pipeline: a click on a short link is published to a Redis stream,
  a Rust consumer lands it in an embedded DuckDB file, the UI charts it —
  three services, zero synchronous coupling;
- everything rides one Helm chart and the same GitOps pipeline on all four
  environments (minikube / OrbStack / LAN VM / VPS+TLS).

## 3. UI tour (2–3 min)

Browser, [http://grogu.test/](http://grogu.test/), log in as **demo/demo**.

| View | What to show | Talking point |
|---|---|---|
| **API playground** (`/`) | switch nodejs/golang × public/private; hit `private` **logged out** → 401; log in → 200 | "JWT validation happens at the gateway — the backends never see an invalid token. Same contract, two languages." |
| **Notes** (`/notes`) | create a note; point at the `golang · PostgreSQL` badge | "The relational domain. Owner attribution comes from the JWT claims." |
| **Links + analytics** (`/links`) | 1. create a short link → notification shows the code; 2. press **click** → new tab opens + orange toast; 3. watch the summary cards and the per-day chart tick up within ~5s | THE demo moment: "That click just traveled: express → Redis stream → Rust consumer → DuckDB → chart. Async, at-least-once, deduped by stream entry id." Also: search box (FTS5 over libSQL), per-link referrer bars. |
| **Jobs** (`/jobs`) | enqueue fibonacci(10) → status queued → processing → done, result 55 | "Background work on Redis Streams; the worker is a separate Deployment and scales independently." |
| **Token** (`/token`) | decoded JWT, copy button | "The front is a pure resource client — PKCE, silent refresh 60s before expiry." |

## 4. Live under the hood (2 min)

Terminal split-screens:

- `watch kubectl get pods` — point at nodejs-back, nodejs-worker, rust-back,
  libsql, postgres, redis, krakend x2: "each with its own init containers,
  probes, PDB, NetworkPolicy".
- `kubectl logs deploy/rust-back-deployment | tail` — the consumer loop line.
- `kubectl exec -it deploy/rust-back-deployment -- /rust-back --help`? no —
  instead: `curl` the summary endpoint through the gateway and show the JSON
  the charts are fed.
- Grafana ([grafana.test](http://grafana.test), admin/prom-operator):
  open **Click analytics pipeline** — clicks/min while the load generator
  runs; then **Demo stack overview** — HPA replicas.

## 5. Load + autoscaling finale (1–2 min)

`./start --load-generator` (or scale the existing one):

- 20 busybox pods hit nodejs `/fibonacci`, golang fibonacci via the gateway
  **and** the seeded short link — so CPU scales AND the analytics pipeline
  lights up at the same time;
- `kubectl get hpa -w` — nodejs climbs toward 10, rust toward 3;
- Grafana: click ingest rate climbing with zero errors; HPA panel.

## 6. The learning map (30s, closing)

Read from this table — "everything here is a resume line":

| Piece | What you learn |
|---|---|
| database-per-service + NetworkPolicies | microservice data ownership |
| libSQL on k8s (StatefulSet, ConfigMap migrations) | the SQLite-server renaissance |
| DuckDB embedded OLAP + PVC | streaming analytics without a DB server |
| Redis Streams × 2 consumer groups | event-driven architecture, at-least-once, idempotency |
| rust/axum + distroless + prometheus | production Rust services |
| React 19 + Mantine + TanStack Query | modern SPA patterns |
| KrakenD no-op passthrough + JWT at the edge | API gateway design |
| Helm chart + ArgoCD + SOPS | GitOps end to end |
| HPA, PDB, probes, netpols | k8s production hardening |
| roadmap: Rollouts canary · KEDA · MinIO backups · Chaos Mesh | progressive delivery, event autoscaling, DR, chaos engineering |

## Recording tips

- `./start --skip-smoke` for re-takes (the cluster is already up).
- The links→analytics tick takes up to ~5s (frontend polls every 5s; the
  stream itself is sub-second) — pause on the cards after clicking.
- If the summary card doesn't move, check `kubectl logs deploy/rust-back-deployment`
  — the consumer line plus `analytics_clicks_ingested_total` in
  [prom.test](http://prom.test) tells you which hop failed.
- Zoom: the StackBadges on every card are the "which service, which database"
  thread — keep them in frame.
