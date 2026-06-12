.PHONY: help deploy status logs-main logs-webhook logs-worker logs-api logs-api-worker logs-dashboard \
        scale-workers scale-api backup update down rebuild-api rebuild-dashboard migrate seed-tenant \
        cutover-agent

STACK=n8n

help: ## Muestra esta ayuda
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

deploy: ## Despliega o actualiza el stack completo
	@bash scripts/deploy.sh

status: ## Estado de todos los servicios
	@docker stack services $(STACK)
	@echo ""
	@docker stack ps $(STACK) --no-trunc

logs-main: ## Logs del proceso principal (UI)
	docker service logs -f $(STACK)_n8n-main

logs-webhook: ## Logs del webhook processor
	docker service logs -f $(STACK)_n8n-webhook

logs-worker: ## Logs de los workers
	docker service logs -f $(STACK)_n8n-worker

logs-minio: ## Logs de MinIO
	docker service logs -f $(STACK)_minio

scale-workers: ## Escalar workers n8n: make scale-workers N=5
	docker service scale $(STACK)_n8n-worker=$(N)

logs-api: ## Logs de la API DM Setter
	docker service logs -f $(STACK)_api

logs-api-worker: ## Logs del worker BullMQ
	docker service logs -f $(STACK)_api-worker

logs-dashboard: ## Logs del dashboard analítico
	docker service logs -f $(STACK)_dashboard

scale-api: ## Escalar API: make scale-api N=2
	docker service scale $(STACK)_api=$(N)
	docker service scale $(STACK)_api-worker=$(N)

rebuild-dashboard: ## Reconstruir imagen dm-dashboard:local y refrescar servicio
	docker build -t dm-dashboard:local -f apps/dashboard/Dockerfile .
	docker service update --force --image dm-dashboard:local $(STACK)_dashboard

rebuild-api: ## Reconstruir imagen dm-api:local y refrescar servicios
	docker build -t dm-api:local -f apps/api/Dockerfile .
	docker service update --force --image dm-api:local $(STACK)_api
	docker service update --force --image dm-api:local $(STACK)_api-worker

migrate: ## Re-aplicar migraciones drizzle (one-shot)
	docker service update --force --detach=true --image dm-api:local $(STACK)_api-migrate

seed-tenant: ## Crea tenant inicial: make seed-tenant SLUG=dev N8N_WORKFLOW_URL=https://...
	@test -n "$(SLUG)" || (echo "Falta SLUG=..." && exit 1)
	@set -a; . ./.env; set +a; \
	docker run --rm \
	  --network $(STACK)_n8n_internal \
	  -e DATABASE_URL="postgres://n8n:$$POSTGRES_PASSWORD@postgres:5432/n8n" \
	  -e SEED_TENANT_SLUG="$(SLUG)" \
	  -e SEED_TENANT_NAME="$(or $(NAME),$(SLUG))" \
	  -e SEED_N8N_WORKFLOW_URL="$(N8N_WORKFLOW_URL)" \
	  dm-api:local \
	  node /app/packages/db/dist/seed.js

cutover-agent: ## Fase 4 ADR-0024: inicializar dialogue_states para leads vivos. Usar: make cutover-agent SLUG=qc [DRY=--dry-run]
	@test -n "$(SLUG)" || (echo "Falta SLUG=... (ej: make cutover-agent SLUG=qc)" && exit 1)
	@set -a; . ./.env; set +a; \
	docker run --rm \
	  --network $(STACK)_n8n_internal \
	  -e DATABASE_URL="postgres://n8n:$$POSTGRES_PASSWORD@postgres:5432/n8n" \
	  -e REDIS_URL="redis://redis:6379" \
	  -e ANTHROPIC_API_KEY="$$ANTHROPIC_API_KEY" \
	  dm-api:local \
	  node /app/apps/agent/dist/scripts/cutover.js --tenant-slug $(SLUG) $(DRY)

backup: ## Backup de PostgreSQL y MinIO
	@bash scripts/backup.sh

update: ## Actualizar imágenes y redesplegar
	docker service update --image n8nio/n8n:latest $(STACK)_n8n-main
	docker service update --image n8nio/n8n:latest $(STACK)_n8n-webhook
	docker service update --image n8nio/n8n:latest $(STACK)_n8n-worker

down: ## Eliminar el stack completo (los volúmenes persisten)
	docker stack rm $(STACK)
	@echo "⚠️  Los volúmenes con datos NO se eliminan. Para borrarlos: docker volume prune"
