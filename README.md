#### local launch for mac with docker desktop and minikube:

```bash
minikube start --driver=docker --cni=calico
minikube addons enable metrics-server

# separate terminal
sudo minikube tunnel
```

vite docker k8s envs
https://dev.to/borisuu/setup-vite-vuejs-docker-32fb
https://medium.com/ocp-digital-factory/reactjs-environment-variable-in-kubernetes-1f680b8d7e49


helm install ap ./helm-chart

grafana
login: admin
password:
kubectl get secret service/ap-grafana -o jsonpath="{.data.admin-password}" | base64 --decode ; echo


https://facelessnomad.medium.com/deploying-your-app-and-database-with-helm-on-kubernetes-8ba20733eea9


# Add kubernetes-dashboard repository
helm repo add kubernetes-dashboard https://kubernetes.github.io/dashboard/
# Deploy a Helm Release named "kubernetes-dashboard" using the kubernetes-dashboard chart
helm upgrade --install kubernetes-dashboard kubernetes-dashboard/kubernetes-dashboard --create-namespace --namespace kubernetes-dashboard

// maybe useful if command above fails
 kubectl -n kubernetes-dashboard port-forward svc/kubernetes-dashboard-kong-proxy 8443:443

kubectl proxy


secrets
https://github.com/jkroepke/helm-secrets/wiki/Installation

helm plugin install https://github.com/jkroepke/helm-secrets --version v4.6.2

brew install gpg
brew install sops

gpg --list-keys
gpg --gen-key
Real name: user1
Email address: exampleuser1@mail.com
Passphrase: example1
Repeat: example11

copy from pub smth like this: F2FE472E3C1C591C28397F3228DD210EB5889A8B

sops -p F2FE472E3C1C591C28397F3228DD210EB5889A8B secrets.yaml

add next secrets:



# edit secrets
GPG_TTY=$(tty)
export GPG_TTY

helm secrets edit secrets.yaml 

touch .sops.yaml
creation_rules:
- pgp: "F2FE472E3C1C591C28397F3228DD210EB5889A8B"

helm secrets encrypt -i secrets.yaml
helm secrets decrypt -i secrets.yaml


helm secrets install ap ./helm-chart -f secrets.yaml
helm secrets upgrade ap ./helm-chart -f secrets.yaml


 /opt/keycloak/bin/kc.sh -Dkeycloak.migration.action=export -Dkeycloak.migration.provider=dir -Dkeycloak.migration.dir=/opt/jboss/keycloak-export -Dkeycloak.migration.usersExportStrategy=REALM_FILE -Djboss.http.port=8888 -Djboss.https.port=9999 -Djboss.management.http.port=7777 -Djboss.management.https.port=7776 


  /opt/keycloak/bin/kc.sh export --dir /tmp/realm-export.json --users realm_file 