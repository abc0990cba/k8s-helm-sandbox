#### local launch for mac with docker desktop and minikube:

```bash
minikube start --driver=docker --cni=calico
minikube addons enable metrics-server

# separate terminal
sudo minikube tunnel
```

helm install ap ./helm-chart

grafana
login: admin
password:
kubectl get secret "GRAFANA_SERVICE_NAME_HERE" -o jsonpath="{.data.admin-password}" | base64 --decode ; echo