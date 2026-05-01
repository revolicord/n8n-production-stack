# n8n Production Stack

Stack de n8n en producción con Docker Swarm, Traefik, MinIO, Redis y PostgreSQL.

## Arquitectura

```
Internet (HTTP/HTTPS)
       │
       ▼
  Traefik v3.3  — TLS automático Let's Encrypt
       │
       ├── <N8N_HOST>/webhook/*  → n8n-webhook  (prioridad 10)
       ├── <N8N_HOST>/*          → n8n-main     (UI + API, prioridad 1)
       ├── <MINIO_DOMAIN>        → MinIO S3 API
       └── <MINIO_CONSOLE_DOMAIN>→ MinIO Console
                   │
             [Redis Queue - Bull]
             /      |      \
       [worker] [worker] [worker]   ← 3 réplicas, escalables
             \      |      /
          [PostgreSQL] [MinIO]
```

## Prerequisitos

- [ ] Servidor con Ubuntu 22.04 o Debian 12
- [ ] Docker instalado (`curl -fsSL https://get.docker.com | sh`)
- [ ] Puertos 80 y 443 abiertos en el firewall
- [ ] 3 registros DNS apuntando a la IP del servidor:
  - `n8n.tudominio.com`
  - `minio.tudominio.com`
  - `minio-console.tudominio.com`

## Instalación desde cero (una sola vez)

```bash
# 1. Clonar el repositorio
git clone <URL-DEL-REPO> /opt/n8n-production
cd /opt/n8n-production

# 2. Dar permisos a los scripts
chmod +x scripts/*.sh

# 3. Ejecutar setup (instala Traefik, genera credenciales, despliega todo)
bash scripts/setup.sh
```

El script `setup.sh`:
- Pide los dominios y email para SSL
- Genera credenciales seguras y crea el `.env`
- Inicializa Docker Swarm (si no está activo)
- Crea la red overlay `traefik-public`
- Instala Traefik v3.3 con Let's Encrypt
- Despliega el stack completo

## Reinstalar / actualizar (cuando ya está corriendo)

```bash
cd /opt/n8n-production
make deploy    # redesplegar con los cambios actuales
make update    # actualizar imágenes n8n a latest
make status    # ver estado de todos los servicios
```

## Operaciones habituales

```bash
make status             # Estado de todos los servicios
make logs-main          # Logs del proceso principal (UI)
make logs-webhook       # Logs del receptor de webhooks
make logs-worker        # Logs de los workers
make scale-workers N=5  # Escalar a 5 workers
make backup             # Backup manual de Postgres + MinIO
make update             # Actualizar n8n a latest
make down               # Parar el stack (datos seguros en volúmenes)
```

## Backup automático (cron diario a las 2am)

```bash
crontab -e
# Añadir:
0 2 * * * /opt/n8n-production/scripts/backup.sh >> /var/log/n8n-backup.log 2>&1
```

## Configurar webhooks

1. Entrar a `https://n8n.tudominio.com` y crear la cuenta
2. Crear workflow → trigger **Webhook**
3. Activar el workflow
4. Copiar la URL de producción (siempre empieza por `/webhook/`)
5. Pegar en la plataforma externa (ManyChat, etc.)

Verificar que el webhook responde:
```bash
curl -X POST https://n8n.tudominio.com/webhook/TU_PATH \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

## Variables de entorno (.env)

| Variable | Descripción |
|---|---|
| `N8N_HOST` | Dominio del panel n8n |
| `N8N_ENCRYPTION_KEY` | Clave de cifrado de credenciales — **NO cambiar** después del primer deploy |
| `POSTGRES_PASSWORD` | Contraseña de PostgreSQL |
| `REDIS_PASSWORD` | Contraseña de Redis |
| `MINIO_ROOT_USER` | Usuario admin de MinIO |
| `MINIO_ROOT_PASSWORD` | Contraseña admin de MinIO |
| `MINIO_DOMAIN` | Dominio público S3 |
| `MINIO_CONSOLE_DOMAIN` | Dominio consola MinIO |
| `TRAEFIK_NETWORK` | Red Docker overlay de Traefik (`traefik-public`) |

## Troubleshooting

**n8n no responde / Traefik da 404**
```bash
# Verificar que todos los servicios están corriendo
docker stack services n8n

# Verificar que Traefik está en la red correcta
docker service inspect traefik --format '{{range .Endpoint.VirtualIPs}}{{.NetworkID}} {{end}}'

# Forzar redescubrimiento de servicios
docker service update --force traefik
```

**Certificados SSL no se generan**
```bash
# Los dominios deben apuntar al servidor ANTES de arrancar Traefik
# Verificar con:
dig +short n8n.tudominio.com

# Si los DNS se configuraron después de instalar Traefik:
docker service update --force traefik
```

**Workers no procesan jobs**
```bash
make logs-worker   # buscar errores de conexión a Redis o Postgres
make status        # verificar que los 3 workers están Running
```

## ADRs (Decisiones arquitecturales)

- [ADR-0001](docs/adr/0001-arquitectura-general.md) — Arquitectura general
- [ADR-0002](docs/adr/0002-swarm-replicas.md) — Docker Swarm para réplicas
- [ADR-0003](docs/adr/0003-almacenamiento-minio.md) — Almacenamiento con MinIO
- [ADR-0004](docs/adr/0004-proxy-traefik.md) — Routing con Traefik
- [ADR-0005](docs/adr/0005-webhooks-manychat.md) — Integración webhooks
