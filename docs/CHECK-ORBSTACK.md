# Checking the app on OrbStack — a short local checklist

The orbstack target is a full rehearsal of the remote pipeline (Ansible + ArgoCD
GitOps, in-machine Gitea CI + registry) inside an OrbStack Ubuntu machine
(`k3s-orbstack`, IP `192.168.139.195`).

## Bring it up

```bash
./start orbstack                # first time of the day / after machine changes
./start orbstack --skip-bootstrap   # when only chart/app code changed (fast path)
```

Both are idempotent. The run: ssh tunnel for the k8s API → waits for the ArgoCD
app `ap` to be Healthy/Synced → runs the full smoke suite (basic HTTP checks,
then deep: notes CRUD on golang, the links flow **including the click crossing
redis → DuckDB analytics**, 401 negatives, an async job consumed by the worker
with fib(10)=55). Everything green = the whole story works.

> The Mac must stay awake for the duration — `caffeinate -dims ./start orbstack`
> if you walk away.

## Browser check (5 minutes)

Install the `*.test` host entries once (sudo):

```bash
scripts/dev-hosts.sh orbstack --install
```

Then open [http://grogu.test/](http://grogu.test/) and log in **demo / demo**:

1. **API playground** — hit `private` logged out → 401 (the gateway validating
   JWT); log in → 200. Switch nodejs/golang.
2. **Links + analytics** — create a short link, press **click**, watch the
   summary cards and the per-day chart tick up within ~5 s. That click just
   traveled: nodejs → redis `clicks` stream → rust consumer → DuckDB.
3. **Jobs** — enqueue fibonacci(10) → queued → done, result **55**.
4. **Notes** — create a note (golang/postgres domain).
5. **Token** — decoded JWT.

Keycloak admin: [http://auth.test/](http://auth.test/) (admin/admin). Grafana
(metrics are ON here): [http://grafana.test/](http://grafana.test/),
admin/prom-operator — dashboards *Demo stack overview* + *Click analytics
pipeline*.

## CLI checks

```bash
# everything on one screen (from the Mac):
ssh ubuntu@192.168.139.195 sudo k3s kubectl get pods
# the three backends + their three stores:
ssh ubuntu@192.168.139.195 sudo k3s kubectl get pods \
  -o custom-columns='POD:.metadata.name,READY:.status.containerStatuses[*].ready'

# no hosts file? curl --resolve works without it:
curl -s --resolve grogu.test:80:192.168.139.195 http://grogu.test/api/v1/rust/analytics/summary
curl -s --resolve grogu.test:80:192.168.139.195 http://grogu.test/api/v1/nodejs/links | head -c 200

# click a link and watch it land in DuckDB analytics:
CODE=$(curl -s --resolve grogu.test:80:192.168.139.195 -X POST \
  -H 'Content-Type: application/json' -d '{"url":"https://kubernetes.io"}' \
  http://grogu.test/api/v1/nodejs/links | sed -n 's/.*"code":"\([^"]*\)".*/\1/p')
curl -s --resolve grogu.test:80:192.168.139.195 http://grogu.test/api/v1/nodejs/links/$CODE > /dev/null  # the click
sleep 3
curl -s --resolve grogu.test:80:192.168.139.195 http://grogu.test/api/v1/rust/analytics/links/$CODE
```

## When something looks off

```bash
ssh ubuntu@192.168.139.195 sudo k3s kubectl get pods            # who is not Ready
ssh ubuntu@192.168.139.195 sudo k3s kubectl logs deploy/rust-back-deployment --tail=30
ssh ubuntu@192.168.139.195 sudo k3s kubectl logs deploy/nodejs-worker-deployment --tail=30
ssh ubuntu@192.168.139.195 sudo k3s kubectl -n argocd get app ap   # sync status
```

- Stuck init containers → libSQL/redis not up yet; give it a minute.
- ArgoCD `Progressing` after a push → CI is building new images; wait for the
  `[skip ci]` bump commit, then re-run `./start orbstack --skip-bootstrap`.
- Teardown: `./stop orbstack` (add `--purge` to also delete the machine).

## The one-wave deploy story (what CI does here)

`git push` (the `gitea` remote) → Gitea Actions builds changed services into
the in-machine registry → bumps `values-orbstack.yaml` → mirrors to the local
git repo → ArgoCD syncs. Note for slow lanes: the rust image compiles bundled
DuckDB (~10–20 min); the Mac sleeping mid-build kills it — use `caffeinate`.
