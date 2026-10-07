# v2 — the polyglot stack as Kubernetes objects (what `helm template` renders).
# Regenerates fullstack_app_in_k8s_cluster.png next to this file.
# Needs: pip install diagrams, brew install graphviz.
from diagrams import Cluster, Diagram, Edge
from diagrams.onprem.monitoring import Grafana, Prometheus
from diagrams.k8s.compute import Deploy
from diagrams.k8s.network import Service
from diagrams.k8s.clusterconfig import HPA
from diagrams.k8s.podconfig import ConfigMap, Secret
from diagrams.k8s.compute import StatefulSet, Job, Cronjob
from diagrams.k8s.storage import PV, PVC
from diagrams.k8s.network import Netpol, Ingress
from diagrams.generic.storage import Storage
from diagrams.generic.device import Mobile

GRAPH = dict(penwidth="2.0")

with Diagram(name="Fullstack app v2 in k8s cluster", filename="fullstack_app_in_k8s_cluster", show=False, graph_attr=dict(labelloc="t", fontsize="22")):

    browser = Mobile("browser\n*.test")

    with Cluster("ingress-nginx"):
        ingress = Ingress("grogu.test / auth.test")

    with Cluster("frontend"):
        frontDeploy = Deploy("react-front\nReact 19 + Mantine")
        frontSvc = Service("react-front-svc")
        ingress >> Edge(**GRAPH) << frontSvc >> frontDeploy

    with Cluster("api-gateway"):
        gwDeploy = Deploy("krakend x2")
        gwSvc = Service("krakend-gateway-svc")
        gwCm = ConfigMap("krakend.json\n(routes + JWKS)")
        gwSmon = Prometheus("smon")
        ingress >> Edge(**GRAPH) << gwSvc >> gwDeploy << Edge(**GRAPH) << gwCm
        gwSmon >> Edge(color="firebrick", style="dashed") << gwDeploy

    with Cluster("auth"):
        kcDeploy = Deploy("keycloak 26")
        kcSvc = Service("keycloak-svc")
        kcSts = StatefulSet("postgres-backed")
        ingress >> Edge(**GRAPH) << kcSvc >> kcDeploy >> kcSts

    with Cluster("notes domain (golang · postgresql)"):
        with Cluster("stateless"):
            goDeploy = Deploy("golang-back")
            goSvc = Service("golang-svc")
            goHpa = HPA("hpa 1-5")
            goSmon = Prometheus("smon")
            goPol = Netpol("netpol")
        gwDeploy >> Edge(**GRAPH) << goSvc >> goDeploy << goHpa
        goSmon >> Edge(color="firebrick", style="dashed") << goSvc
        with Cluster("stateful"):
            pgSts = StatefulSet("postgres 17")
            pgPvc = PVC("hostPath PV 1Gi")
            pgSts >> pgPvc
            pgSecret = Secret("postgres-secret\n(SOPS)")
            pgMigration = Job("migration v3\n(all files in order)")
            pgReport = Cronjob("report @daily (SQL)")
            pgBackup = Cronjob("pg_dumpall @daily")
            pgSts << pgSecret
            pgMigration >> pgSts
            pgReport >> pgSts
            pgBackup >> pgSts
        goDeploy >> Edge(**GRAPH) << pgSts
        kcDeploy >> Edge(**GRAPH) << pgSts

    with Cluster("links + jobs domain (nodejs · libSQL)"):
        with Cluster("stateless"):
            nodeDeploy = Deploy("nodejs-back")
            workerDeploy = Deploy("nodejs-worker")
            nodeSvc = Service("nodejs-svc")
            nodeHpa = HPA("hpa 1-10")
            nodeSmon = Prometheus("smon")
            nodePol = Netpol("netpol")
        gwDeploy >> Edge(**GRAPH) << nodeSvc >> nodeDeploy << nodeHpa
        nodeSmon >> Edge(color="firebrick", style="dashed") << nodeSvc
        with Cluster("stateful"):
            libsqlSts = StatefulSet("libSQL (sqld)\nstandalone")
            libsqlPvc = PVC("PVC 500Mi")
            libsqlJob = Job("libsql-migration v1\n(ConfigMap SQL)")
            libsqlCm = ConfigMap("migrations-libsql")
            libsqlSts >> libsqlPvc
            libsqlJob >> Edge(**GRAPH) << libsqlSts
            libsqlJob << libsqlCm
        nodeDeploy >> Edge(**GRAPH) << libsqlSts
        workerDeploy >> Edge(**GRAPH) << libsqlSts

    with Cluster("analytics domain (rust · duckdb)"):
        with Cluster("stateless"):
            rustDeploy = Deploy("rust-back\naxum")
            rustSvc = Service("rust-svc")
            rustHpa = HPA("hpa 1-3")
            rustSmon = Prometheus("smon")
            rustPol = Netpol("netpol")
        gwDeploy >> Edge(**GRAPH) << rustSvc >> rustDeploy << rustHpa
        rustSmon >> Edge(color="firebrick", style="dashed") << rustSvc
        rustPvc = PVC("PVC 200Mi\nclicks.duckdb · fsGroup")
        rustDeploy >> rustPvc

    with Cluster("async backbone"):
        redisSts = StatefulSet("redis 7.4\njobs + clicks streams")
        redisPvc = PVC("PVC 400Mi")
        redisCm = ConfigMap("redis.conf")
        redisSts >> redisPvc
        redisSts << redisCm
        nodeDeploy >> Edge(color="darkorange", **GRAPH) << redisSts
        workerDeploy >> Edge(color="firebrick", style="dashed", label="XREADGROUP") << redisSts
        nodeDeploy >> Edge(color="firebrick", style="dashed", label="XADD clicks") >> redisSts
        rustDeploy >> Edge(color="firebrick", style="dashed", label="XREADGROUP") << redisSts

    with Cluster("load-generator (optional)"):
        loadgen = Deploy("busybox x20\nfibonacci + links")

    with Cluster("monitoring (optional, --metrics)"):
        prom = Prometheus("prometheus\n2h retention")
        grafana = Grafana("grafana\n2 dashboards")
        prom >> Edge(color="firebrick", style="dashed") << grafana

    loadgen >> Edge(color="darkorange", **GRAPH) << gwSvc
    browser >> Edge(**GRAPH) << ingress
