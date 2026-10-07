from diagrams import Cluster, Diagram, Edge
from diagrams.onprem.monitoring import Grafana, Prometheus
from diagrams.k8s.compute import Deploy
from diagrams.k8s.network import Service
from diagrams.k8s.clusterconfig import HPA
from diagrams.k8s.podconfig import ConfigMap
from diagrams.k8s.podconfig import Secret
from diagrams.k8s.compute import StatefulSet
from diagrams.k8s.compute import Job
from diagrams.k8s.compute import Cronjob
from diagrams.k8s.storage import PV
from diagrams.k8s.storage import PVC
from diagrams.k8s.network import Netpol
from diagrams.k8s.network import Ingress 

with Diagram(name="Fullstack app in k8s cluster", show=True):
    with Cluster("ingress"):
        ingress = Ingress("nginx")

    with Cluster("frontend"):
        reactDeploy = Deploy("react-deploy")
        reactService = Service("react-svc")
        reactService >> reactDeploy >> ingress >> reactService

    with Cluster("api-gateway"):
        krakendDeploy = Deploy("krakend-deploy")
        krakendService = Service("krakend-svc-clusterip")
        krakendConfigMap = ConfigMap("krakend-configmap")
        ingress >> krakendService >> krakendDeploy << krakendConfigMap 

    with Cluster("backend"):
        with Cluster("nodejs backend"):
            nodeDeploy = Deploy("nodejs-deploy")
            nodeService = Service("nodejs-svc-clusterip")
            nodeHPA = HPA("nodejs-hpa")
            krakendDeploy >> nodeService >> nodeDeploy << nodeHPA 
        with Cluster("golang backend"):
            goDeploy = Deploy("go-deploy")
            goService = Service("go-svc-clusterip")
            krakendDeploy >> goService >> goDeploy

    with Cluster("auth"):
        keycloakDeploy = Deploy("keycloak-deploy")
        keycloakService = Service("keycloak-svc-clusterip")
        keycloakConfigMap = ConfigMap("keycloak-configmap")
        keycloakSecret = Secret("keycloak-secret")

        ingress >> keycloakService >> keycloakDeploy
        keycloakDeploy >> keycloakConfigMap
        keycloakDeploy >> keycloakSecret  
        krakendDeploy >> keycloakService

    with Cluster("cache"):
        redisDeploy = Deploy("redis-deploy")
        redisService = Service("redis-svc")
        redisNetpol = Netpol("redis-netpol")
        
        redisService >> redisDeploy
        nodeDeploy >> redisService

    with Cluster("database"):
        postgresSts = StatefulSet("postgres-sts")
        postgresService = Service("postgres-svc-clusterip")
        postgresSecret = Secret("postgres-secret")
        migrationJob = Job("migration-job")
        backupCronjob = Cronjob("backup-cronjob")
        cleanBackupCronjob = Cronjob("clean-backup-cronjob")
        migrationConfigMap = ConfigMap("migration-configmap")
        postgresPV = PV("postgres-pv")
        postgresPVC = PVC("postgres-pvc")
        postgresNetpol = Netpol("postgres-netpol")

        ingress >> postgresService >> postgresSts >> postgresSecret 
        postgresSts >> postgresPV << postgresPVC
        migrationConfigMap << migrationJob >> postgresService
        backupCronjob >> postgresService
        cleanBackupCronjob >> postgresService
        nodeDeploy >> postgresService
        goDeploy >> postgresService


    with Cluster("monitoring"):
      metrics = Prometheus("prometheus")
      metrics << Edge(color="firebrick", style="dashed") << Grafana("grafana")
      metrics >> nodeDeploy
      metrics >> goDeploy




  
    