## steps:

for mac with docker desktop and minikube

//for network policy
minikube start --driver=docker --cni=calico

minikube addons enable metrics-server


sudo minikube tunnel
