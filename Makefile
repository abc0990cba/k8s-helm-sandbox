SHELL := /bin/bash

.PHONY: start stop status upgrade secrets-edit check

start:            ## bring the whole stack up (idempotent) — the one command
	@./start

stop:             ## helm uninstall + stop tunnel ('make stop PURGE=1' also deletes the cluster)
	@./stop $(if $(PURGE),--purge,)

status:           ## cluster / pods / release / tunnel / URL status
	@bash scripts/status.sh

upgrade:          ## re-deploy the chart (same as start, helm upgrade --install)
	@bash scripts/local-up.sh --skip-smoke

secrets-edit:     ## edit SOPS-encrypted secrets.yaml
	@GPG_TTY=$$(tty) helm secrets edit secrets.yaml

check:            ## preflight: verify all tools are installed
	@bash scripts/local-up.sh --check-only
