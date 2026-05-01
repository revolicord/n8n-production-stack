.PHONY: help deploy status logs-main logs-webhook logs-worker scale-workers backup update down

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

scale-workers: ## Escalar workers: make scale-workers N=5
	docker service scale $(STACK)_n8n-worker=$(N)

backup: ## Backup de PostgreSQL y MinIO
	@bash scripts/backup.sh

update: ## Actualizar imágenes y redesplegar
	docker service update --image n8nio/n8n:latest $(STACK)_n8n-main
	docker service update --image n8nio/n8n:latest $(STACK)_n8n-webhook
	docker service update --image n8nio/n8n:latest $(STACK)_n8n-worker

down: ## Eliminar el stack completo (los volúmenes persisten)
	docker stack rm $(STACK)
	@echo "⚠️  Los volúmenes con datos NO se eliminan. Para borrarlos: docker volume prune"
