# ADR-0002: Docker Swarm para réplicas de workers

**Status:** Accepted  
**Date:** 2026-05-01

---

## Y-Statement

> _In the context of_ needing 3 worker replicas that survive container failures and scale declaratively,  
> _facing_ the limitation that `deploy.replicas` is silently ignored by plain `docker compose up`,  
> _we decided_ to use **Docker Swarm** (`docker stack deploy`) instead of plain Docker Compose,  
> _to achieve_ native replica management, restart policies, and rolling updates with zero downtime,  
> _accepting_ that `docker compose` commands are replaced by `docker stack` / `docker service` commands.

---

## Contexto

El ejemplo de referencia usaba `deploy.replicas: 3` en un compose ordinario. Esto no funciona:
`docker compose up` ignora completamente el bloque `deploy:` — sólo se levanta 1 worker.

El servidor ya tiene Docker Swarm activo en modo single-node manager (verificado: `docker info`).
La red `dokploy-network` (overlay, scope swarm) ya existe y Traefik la usa para descubrir servicios.

## Decisión

Desplegar como **Docker Stack** con `docker stack deploy -c docker-stack.yml n8n`.

| Feature | docker compose up | docker stack deploy |
|---|---|---|
| `deploy.replicas` | ❌ ignorado | ✅ funciona |
| Rolling updates | ❌ manual | ✅ `docker service update` |
| Restart on failure | básico | ✅ configurable |
| Secrets management | env_file | ✅ Docker secrets (futuro) |
| Healthcheck integration | ✅ | ✅ |

## Implicaciones operativas

```bash
# Desplegar / actualizar
docker stack deploy -c docker-stack.yml n8n --with-registry-auth

# Ver servicios
docker stack services n8n

# Escalar workers en caliente
docker service scale n8n_n8n-worker=5

# Ver logs de un servicio
docker service logs -f n8n_n8n-worker

# Eliminar el stack completo
docker stack rm n8n
```

## Limitaciones aceptadas

- `env_file:` no funciona con `docker stack deploy` — las variables se pasan via `environment:` con interpolación desde el entorno del shell.
- El script `scripts/deploy.sh` exporta las variables desde `.env` antes de hacer el deploy.
- Los volúmenes son `driver: local` → datos locales al nodo. Si se añade un segundo nodo al Swarm, se necesitaría NFS o un volume driver distribuido.
