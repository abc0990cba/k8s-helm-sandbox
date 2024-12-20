### Architecture
![alt text](./diagram-as-code/fullstack_app.png)
![alt text](./diagram-as-code/fullstack_app_in_k8s_cluster.png)
---
### TODO
- [x] helm
- [x] react front
- [x] postgres
- [x] redis cache
- [ ] migrate redis from deployment to statefulset
- [x] node.js api
- [x] golang api
- [x] krakend api gateway
- [x] postgres using k8s pvc
- [x] redis using k8s pvc
- [x] keycloak for auth
- [x] api start working only after postgres and redis using initContainers
- [x] ingress
- [x] health checks
- [x] container limits
- [x] db migration using k8s job
- [x] db daily backups using cronjobs
- [x] db weekly backups cleaners using cronjobs
- [x] secrets with PGP and SOPS for sensitive info
- [x] restart policies
- [x] network policies
- [x] horizontal pod autoscaling
- [x] prometheus
- [x] grafana
- [x] connect redis to node.js
- [x] connect redis to golang
- [x] metrics for node.js api
- [ ] metrics for golang api
- [x] hpa for node.js api
- [ ] hpa for golang api
- [ ] metrics for postgres
- [ ] metrics for redis
- [x] encrypt postgres secrets with PGP and SOPS
- [x] encrypt keycloak secrets with PGP and SOPS
---
### Prerequisites
- docker / docker desktop [setup](https://docs.docker.com/desktop/setup/install/mac-install/)
- minikube [setup](https://minikube.sigs.k8s.io/docs/start/?arch=%2Fmacos%2Farm64%2Fstable%2Fhomebrew)
- helm [setup](https://helm.sh/docs/intro/install/)
- helm-secrets plugin [setup](https://github.com/jkroepke/helm-secrets/wiki/Installation)
- gpg [setup](https://dev.to/zemse/setup-gpg-on-macos-2iib)
- sops [setup](https://formulae.brew.sh/formula/sops)

---
### Local launch for mac with docker desktop and minikube:

```bash
minikube start --driver=docker --cni=calico

# enable addons
minikube addons enable metrics-server
minikube addons enable ingress-dns
minikube addons enable ingress
minikube addons enable storage-provisioner
minikube addons enable default-storageclass
minikube addons enable dashboard

# add helm repos
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm dependency update

# gpg envs
GPG_TTY=$(tty)
export GPG_TTY

# insert hosts 
# for app, iam, grafana, prometheus
sudo nano /etc/hosts
127.0.0.1 auth.test
127.0.0.1 grogu.test
127.0.0.1 grafana.test   
127.0.0.1 prom.test
 
# additional CustomResourceDefinition for service monitor
kubectl apply -f https://raw.githubusercontent.com/coreos/prometheus-operator/master/example/prometheus-operator-crd/monitoring.coreos.com_servicemonitors.yaml

# import secret key
# ! attention: this file should not be store in git or any other public space
# it is here only for demo purpose
gpg --import demo-secret-key.asc

# [Optional]
# Enable Prometheus and grafana
# Update ./helm-chart/values.yaml
metrics
  enabled: true

# [Optional]
# Enable stress test to check HPA
# Update ./helm-chart/values.yaml
loadGenerator
  enabled: true

# app launch
helm secrets install ap ./helm-chart -f secrets.yaml  

# passphrase for the secret above
passphrase: example1   

# separate terminal
sudo minikube tunnel
```
---
### initial users configuration for keycloak

1. go http://auth.test/
2. insert keycloak admin credentials from secret
   default:
      username: admin
      password: admin
![alt text](assets/image.png)
3. select `demorealm`
![alt text](assets/image-1.png)
4. add `demoname` with credentials
  - add name
  - switch on `emailVerified`
![alt text](assets/image-2.png)
  - add password
  - switch off temporaryPassword
![alt text](assets/image-3.png)

---
### check app work
  - go http://grogu.test/
  - check service work by fetching node.js and golang piblic/private endpoints
![alt text](assets/image-4.png)
---
#### Useful commands
```bash
# Update secrets
helm secrets edit secrets.yaml

# Upgrade helm release
helm secrets upgrade ap ./helm-chart -f secrets.yaml

# Port-forward for local development
kubectl port-forward {postgres-pod-name} 5432
kubectl port-forward {redis-pod-name} 6379

# build and push image to docker hub
# docker build -t {username}/{image-name}:{tag} .
# docker image push {username}/{image-name}:{tag}
docker build -t mmko67/grogu-api:0.0.1 .
docker push mmko67/grogu-api:0.0.1

# edit krakend with design web tool
https://designer.krakend.io/

```
