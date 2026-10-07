# v2 — the polyglot application topology (database-per-service).
# Regenerates fullstack_app.png next to this file. Needs: pip install diagrams, brew install graphviz.
from diagrams import Cluster, Diagram, Edge
from diagrams.onprem.database import PostgreSQL
from diagrams.onprem.inmemory import Redis
from diagrams.onprem.monitoring import Grafana, Prometheus
from diagrams.onprem.network import Nginx
from diagrams.programming.framework import React
from diagrams.programming.language import Nodejs, Rust
from diagrams.programming.language import Go
from diagrams.generic.storage import Storage
from diagrams.saas.identity import Auth0
from diagrams.generic.network import Subnet

GRAPH = dict(penwidth="2.0")

with Diagram(name="Fullstack app v2 — polyglot, database-per-service", filename="fullstack_app", show=False, graph_attr=dict(labelloc="t", fontsize="22")):

    browser = React("browser\n*.test")

    with Cluster("auth"):
        keycloak = Auth0("keycloak 26\n(demorealm, PKCE)")
        browser >> Edge(color="darkgreen", **GRAPH) << keycloak

    with Cluster("ingress"):
        ingress = Nginx("ingress-nginx\ngrogu.test")
    browser >> Edge(**GRAPH) << ingress

    with Cluster("frontend"):
        react = React("react-front\nReact 19 + Mantine 9")
    ingress >> react
    browser >> Edge(color="darkgreen", **GRAPH) << react

    with Cluster("api-gateway (JWT at the edge)"):
        krakend = Subnet("krakend x2\nRS256 via JWKS")
    ingress >> Edge(**GRAPH) << krakend
    krakend >> Edge(color="darkgreen", **GRAPH) << keycloak

    with Cluster("notes domain"):
        golang = Go("golang-back\ngin · HPA 1-5")
    krakend >> Edge(**GRAPH) << golang

    with Cluster("links + jobs domain"):
        nodejs = Nodejs("nodejs-back\nexpress · HPA 1-10")
    krakend >> Edge(**GRAPH) << nodejs

    with Cluster("analytics domain"):
        rust = Rust("rust-back\naxum · HPA 1-3")
    krakend >> Edge(**GRAPH) << rust

    with Cluster("databases (database-per-service)"):
        postgres = PostgreSQL("PostgreSQL 17\nnotes · numbers")
        libsql = Storage("libSQL (sqld)\nlinks · jobs")
        duckdb = Storage("DuckDB file\n(clicks)")
        golang >> Edge(**GRAPH) << postgres
        nodejs >> Edge(**GRAPH) << libsql
        rust >> Edge(**GRAPH) << duckdb

    with Cluster("async backbone (redis streams)"):
        redis = Redis("redis 7.4\njobs + clicks streams · cache")
        nodejs >> Edge(color="darkorange", **GRAPH) << redis
        nodejs >> Edge(color="firebrick", style="dashed") >> redis
        rust >> Edge(color="firebrick", style="dashed", label="XREADGROUP") << redis
        nodejs >> Edge(color="firebrick", style="dashed", label="XADD clicks") >> redis

    with Cluster("monitoring (optional, --metrics)"):
        prom = Prometheus("prometheus")
        grafana = Grafana("grafana")
        prom >> Edge(color="firebrick", style="dashed") << grafana
        prom >> Edge(color="firebrick", style="dashed") << nodejs
        prom >> Edge(color="firebrick", style="dashed") << golang
        prom >> Edge(color="firebrick", style="dashed") << rust
        prom >> Edge(color="firebrick", style="dashed") << krakend
