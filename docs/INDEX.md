# Documentation index — what to read, in what order, for whom

This project is a **copyable reference demo**: a production-shaped polyglot
application (React 19 + Mantine → KrakenD gateway → three backends on three
databases) deployed to Kubernetes through one Helm chart, with a full GitOps
pipeline, CI, observability and chaos tooling. Anyone can fork it, run it on
a laptop, and grow it toward a real cluster.

This index is the map. Pick your path; every path is ordered.

---

## 0. Just run it (10 minutes)

| Step | Doc |
|---|---|
| 1. One command, four environments | [readme.md](../readme.md) |
| 2. Launch guide (minikube / orbstack / lan / vps) | [RUN.md](RUN.md) |
| 3. Verify it on OrbStack (the 5-minute checklist) | [CHECK-ORBSTACK.md](CHECK-ORBSTACK.md) |

```bash
./start                 # local Minikube
./start orbstack        # k3s in an OrbStack machine — full GitOps rehearsal
```

## 1. Newcomer path — "what is this and how does it work?" (~1 hour)

Read in this order:

1. **[readme.md](../readme.md)** — the pitch, prerequisites, what `./start` does.
2. **[TOUR.md](TOUR.md)** — the visual tour: every screen of the UI, Keycloak,
   Prometheus, Grafana, ArgoCD (v1 tour preserved in [archive/v1/](archive/v1/)).
3. **[ARCHITECTURE.md](ARCHITECTURE.md)** — topology, the three
   backends × three databases, data flows, startup ordering, known issues.
4. **[FLOWS.md](FLOWS.md)** — sequence diagrams of every request flow:
   auth, notes, links→clicks→DuckDB, async jobs, the GitOps deploy.
5. **[HOW-DEPLOY-WORKS-RU.md](HOW-DEPLOY-WORKS-RU.md)** *(RU)* — how a code
   change travels from your editor through Helm/ArgoCD into the cluster,
   explained step by step.

## 2. Kubernetes / DevOps learner path (~2 hours, hands-on)

1. [RUN.md](RUN.md) — bring up all four environments; what Ansible provisions.
2. [ARCHITECTURE.md](ARCHITECTURE.md) — probes, PDBs, NetworkPolicies, HPAs,
   StatefulSets, init containers: where each hardening piece lives.
3. [gitops/README.md](../gitops/README.md) — the ArgoCD Application layout,
   the CMP helm-secrets plugin, sync waves.
4. [CHECK-ORBSTACK.md](CHECK-ORBSTACK.md) — the daily-driver checklist +
   troubleshooting commands.
5. [CHAOS.md](CHAOS.md) — break it on purpose (pod kills, latency, stress)
   and watch the hardening absorb it.
6. [DEPLOY-VPS-ARGOCD.md](DEPLOY-VPS-ARGOCD.md) — the real-club version: TLS,
   DNS, Let's Encrypt, costs, day-2.

## 3. Application developer path ("I want to change the code")

1. **[AGENTS.md](../AGENTS.md)** — the repo map, conventions, gotchas and the
   verification workflow (yes it is written for coding agents; it doubles as
   the best developer onboarding doc here).
2. Backend sources, one domain each:
   - `golang-back/` — notes/numbers on PostgreSQL (gin + sqlx).
   - `nodejs-back/` — links + jobs on libSQL (express + @libsql/client +
     a Redis Streams worker).
   - `rust-back/` — click analytics on DuckDB (axum + a stream consumer).
3. `react-front/` — React 19 + Mantine 9 + TanStack Query; the typed API
   layer is `src/api/client.ts`.
4. `helm-chart/` — everything deployable: templates per component, the
   KrakenD route table (`config/krakend.json`), migrations for both SQL
   dialects (`migrations/`, `migrations-libsql/`).
5. Verify like CI does: `helm lint` (one known error), the render matrix,
   unit tests per service — exact commands in AGENTS.md → "Verification
   workflow".

## 4. Demo / video presenter path

1. [DEMO-SCRIPT.md](DEMO-SCRIPT.md) — the shot-by-shot 5–8 minute narrative
   with the learning map at the end.
2. [TOUR.md](TOUR.md) — what to show on each screen.
3. [DEMO-SCRIPT.md](DEMO-SCRIPT.md) → "Recording tips" — the moments that
   land (the click→analytics tick, the HPA climb).

## 5. Russian-language path

1. [HOW-DEPLOY-WORKS-RU.md](HOW-DEPLOY-WORKS-RU.md) — путь кнопки до кластера.
2. [ENVIRONMENTS-RU.md](ENVIRONMENTS-RU.md) — сравнение четырёх окружений.

## 6. Ops / SRE path

1. [ARCHITECTURE.md](ARCHITECTURE.md) → "Known issues" — the honest list.
2. [CHAOS.md](CHAOS.md) + `docs/chaos/*.yaml` — staged experiments with
   expected outcomes.
3. [DEPLOY-VPS-ARGOCD.md](DEPLOY-VPS-ARGOCD.md) → day-2 (backups, restore,
   costs). Roadmap items live at the end of ARCHITECTURE.md and in
   [DEMO-SCRIPT.md](DEMO-SCRIPT.md)'s learning table.

---

## Full catalog

| Doc | For whom | What's inside |
|---|---|---|
| [readme.md](../readme.md) | everyone | pitch, prerequisites, launch |
| [RUN.md](RUN.md) | everyone | launch guide for all four environments |
| [CHECK-ORBSTACK.md](CHECK-ORBSTACK.md) | everyone | verify-the-app checklist + CLI checks |
| [TOUR.md](TOUR.md) | newcomers, presenters | visual tour of every surface (v2) |
| [archive/v1/TOUR-v1.md](archive/v1/TOUR-v1.md) | historians | the pre-split v1 tour + screenshots |
| [ARCHITECTURE.md](ARCHITECTURE.md) | all technical | topology, flows, hardening, known issues |
| [FLOWS.md](FLOWS.md) | developers | sequence diagrams of the new code |
| [AGENTS.md](../AGENTS.md) | developers (+LLMs) | repo map, conventions, verification |
| [DEMO-SCRIPT.md](DEMO-SCRIPT.md) | presenters | video narrative + learning map |
| [CHAOS.md](CHAOS.md) | SRE, presenters | chaos experiments runbook |
| [gitops/README.md](../gitops/README.md) | DevOps | ArgoCD apps, CMP plugin, sync policy |
| [DEPLOY-VPS-ARGOCD.md](DEPLOY-VPS-ARGOCD.md) | ops | VPS + TLS + day-2 + costs |
| [DEPLOY-LAN-VIRTUALBOX.md](DEPLOY-LAN-VIRTUALBOX.md) | ops | VirtualBox VM target |
| [HOW-DEPLOY-WORKS-RU.md](HOW-DEPLOY-WORKS-RU.md) | RU newcomers | как доезжает код до кластера |
| [ENVIRONMENTS-RU.md](ENVIRONMENTS-RU.md) | RU | окружения: minikube/orbstack/lan/vps |

## Forking this as your own project

1. Fork → set your registry + repo in `scripts/orbstack-mode.sh` (github mode)
   or keep the local Gitea loop (local mode works fully offline).
2. Replace SOPS with your own key: `make secrets-edit` after re-encrypting
   `secrets.yaml` (see AGENTS.md "Known issues" #3 — the committed demo key
   is for the demo only).
3. Point `host.app` / `host.auth` at your domains (`values-vps.yaml` + a
   `scripts/build-front.sh` rebuild — Keycloak URLs are baked at build time).
4. `./start` — everything else (cluster, DBs, migrations, auth realm, smoke)
   comes up on its own.
