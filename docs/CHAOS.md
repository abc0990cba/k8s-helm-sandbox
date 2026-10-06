# Chaos experiments — staged, expected outcomes, rollback

Requires Chaos Mesh installed on the target (ansible role `chaos_mesh`,
`chaos_mesh_enabled: true` — opt-in, adds CRDs + controller + dashboard).
Experiments live in `docs/chaos/` and are applied with plain kubectl; each
exists to prove a specific hardening claim about this stack. **Run them one
at a time.** Delete the experiment (`kubectl delete -f <file>`) before the
next one.

Baseline first: `kubectl get pods` all Running/Ready, `make status` clean.

## 1. Kill postgres — proves init containers + probes + the migration path

```bash
kubectl apply -f docs/chaos/pod-kill-postgres.yaml
```

Expected:
- postgres container terminates; StatefulSet recreates it;
- golang-back goes NOT Ready within ~30s (its `/ready` checks the DB) — the
  gateway keeps serving golang 404/503? No: gateway readiness dials
  **nodejs**, so links/jobs/rust keep working — a genuine blast-radius demo;
- new golang pods would wait in init on `wait-for-postgres`;
- after postgres is Ready again, everything self-heals without restarts.

Video moment: the Notes view errors while Links keep working.

## 2. Latency on redis — proves the cache timeouts / stream consumers degrade gracefully

```bash
kubectl apply -f docs/chaos/network-delay-redis.yaml
```

Expected:
- note/list reads still OK (cache misses get slow but bounded by curl/probe
  timeouts); the nodejs worker keeps consuming (5s BLOCK loop absorbs jitter);
- rust-back `/ready` may flap (redis ping inside readiness) — watch the
  gateway stay Ready (it probes nodejs, not rust);
- `watch kubectl get pods` shows no restarts (liveness probes don't hit redis).

## 3. Kill one gateway replica — proves the PDB + zero-downtime strategy

```bash
kubectl apply -f docs/chaos/pod-kill-gateway.yaml
```

Expected:
- the second replica serves every request (watch the smoke suite or the SPA);
- PDB `maxUnavailable: 1` is satisfied throughout;
- `kubectl get pods -l app=gateway` returns to 2/2.

## 4. CPU stress on nodejs — proves the HPA

```bash
kubectl apply -f docs/chaos/cpu-stress-nodejs.yaml
```

Expected:
- `kubectl get hpa nodejs-back-hpa -w` climbs 1 → up to 10;
- after deletion, replicas fall back within the 120s stabilization window.

## Where to watch

- Grafana **Demo stack overview**: restarts, HPA replicas, CPU per pod.
- `kubectl get kubectl get pods -w` and `kubectl describe pod` for the
  probe/init narrative.
- Chaos dashboard: `kubectl -n chaos-mesh port-forward svc/chaos-dashboard 2333:2333`.

## Safety

- Every experiment targets namespace `default` with label selectors — nothing
  touches kube-system or the monitoring stack.
- `duration:` fields bound every experiment; deleting the YAML is the
  immediate rollback.
- Never run experiments 1–2 against the **vps** target with real data —
  postgres kill means a hard kill of the single replica.
