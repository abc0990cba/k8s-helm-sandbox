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


https://facelessnomad.medium.com/deploying-your-app-and-database-with-helm-on-kubernetes-8ba20733eea9


# Add kubernetes-dashboard repository
helm repo add kubernetes-dashboard https://kubernetes.github.io/dashboard/
# Deploy a Helm Release named "kubernetes-dashboard" using the kubernetes-dashboard chart
helm upgrade --install kubernetes-dashboard kubernetes-dashboard/kubernetes-dashboard --create-namespace --namespace kubernetes-dashboard

// maybe useful if command above fails
 kubectl -n kubernetes-dashboard port-forward svc/kubernetes-dashboard-kong-proxy 8443:443

kubectl proxy