SHELL := /bin/bash

.PHONY: start stop status upgrade secrets-edit check lan vps

start:            ## bring the whole stack up (idempotent) — the one command
	@./start

lan:              ## ./start lan — k3s VM in VirtualBox on the LAN (Ansible + ArgoCD)
	@./start lan

vps:              ## ./start vps — k3s on the VPS with TLS (Ansible + ArgoCD)
	@./start vps

stop:             ## helm uninstall + stop tunnel ('make stop PURGE=1' also deletes the cluster)
	@./stop $(if $(PURGE),--purge,)

status:           ## status for local (default) or TARGET=lan|vps
	@bash scripts/status.sh $(TARGET)

upgrade:          ## re-deploy the chart (same as start, helm upgrade --install)
	@bash scripts/local-up.sh --skip-smoke

secrets-edit:     ## edit SOPS-encrypted secrets.yaml
	@GPG_TTY=$$(tty) helm secrets edit secrets.yaml

check:            ## preflight: verify all tools are installed
	@bash scripts/local-up.sh --check-only
