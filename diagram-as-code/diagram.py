from diagrams import Cluster, Diagram, Edge
from diagrams.onprem.database import PostgreSQL
from diagrams.onprem.inmemory import Redis
from diagrams.onprem.monitoring import Grafana, Prometheus
from diagrams.onprem.network import Nginx
from diagrams.programming.framework import React
from diagrams.programming.language import Nodejs
from diagrams.programming.language import Go
from diagrams.onprem.queue import Kafka
from diagrams.saas.identity import Auth0
from diagrams.generic.network import Subnet

with Diagram(name="Fullstack app", show=False):
    with Cluster("ingress"):
        ingress = Nginx("nginx")

    with Cluster("frontend"):
        react = React("react")
        ingress >> react

    with Cluster("backend"):
        backends = [Nodejs("nodejs"), Go("go")]

    with Cluster("api-gateway"):
        krakend = Subnet("krakend")
        react >> Edge(color="darkgreen") << krakend
        krakend >> backends

    with Cluster("auth"):
        keycloak = Auth0("keycloak")
        react >> Edge(color="darkgreen") << keycloak
        krakend >> Edge(color="darkgreen") << keycloak

    with Cluster("cache"):
        redis = Redis("redis")
        backends >> redis

    with Cluster("database"):
        pg = PostgreSQL("postgresql")
        backends >> pg

    with Cluster("monitoring"):
      metrics = Prometheus("prometheus")
      metrics << Edge(color="firebrick", style="dashed") << Grafana("grafana")
      metrics >> backends



  
    