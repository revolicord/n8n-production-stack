# 07 · Docker Compose y deploy

Un único VPS, todo en Docker, n8n ya corriendo en queue mode. Aquí integramos la API.

## Topología

```
VPS (Ubuntu 22.04 LTS recomendado)
│
├── /opt/stack
│   ├── docker-compose.yml
│   ├── .env
│   ├── caddy/
│   │   └── Caddyfile
│   └── data/                ← volumes persistentes
│       ├── postgres/
│       ├── redis/
│       ├── n8n/
│       └── caddy/
│
└── /opt/repos/
    └── manychat-debounce/   ← repo de la API (git pull en cada deploy)
```

## docker-compose.yml (estructura)

```yaml
name: stack

networks:
  internal:
    driver: bridge

volumes:
  postgres_data:
  redis_data:
  n8n_data:
  caddy_data:
  caddy_config:

services:
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes:
      - ./caddy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    networks: [internal]

  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${PG_USER}
      POSTGRES_PASSWORD: ${PG_PASSWORD}
      POSTGRES_DB: ${PG_DB}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./postgres/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    networks: [internal]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${PG_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: >
      redis-server
      --appendonly yes
      --appendfsync everysec
      --maxmemory 1gb
      --maxmemory-policy noeviction
      --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data
    networks: [internal]
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 3s

  api:
    build:
      context: /opt/repos/manychat-debounce
      dockerfile: apps/api/Dockerfile
    restart: unless-stopped
    command: ["node", "dist/server.js"]
    environment:
      NODE_ENV: production
      PORT: 3000
      DATABASE_URL: postgres://${PG_USER}:${PG_PASSWORD}@postgres:5432/${PG_DB}?schema=api
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379/0
      MC_WEBHOOK_TOKEN: ${MC_WEBHOOK_TOKEN}
      N8N_CALLBACK_TOKEN: ${N8N_CALLBACK_TOKEN}
      N8N_BASE_URL: http://n8n-webhook:5678
      PUBLIC_API_URL: https://api.${PUBLIC_DOMAIN}
      ADMIN_JWT_SECRET: ${ADMIN_JWT_SECRET}
      LOG_LEVEL: info
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_healthy }
    networks: [internal]

  api-worker:
    build:
      context: /opt/repos/manychat-debounce
      dockerfile: apps/api/Dockerfile
    restart: unless-stopped
    command: ["node", "dist/worker.js"]
    environment:
      NODE_ENV: production
      DATABASE_URL: postgres://${PG_USER}:${PG_PASSWORD}@postgres:5432/${PG_DB}?schema=api
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379/0
      N8N_CALLBACK_TOKEN: ${N8N_CALLBACK_TOKEN}
      N8N_BASE_URL: http://n8n-webhook:5678
      WORKER_CONCURRENCY: 10
      LOG_LEVEL: info
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_healthy }
    networks: [internal]
    deploy:
      replicas: 1   # Subir a 2-3 si tráfico crece

  n8n-main:
    image: n8nio/n8n:latest
    restart: unless-stopped
    environment:
      EXECUTIONS_MODE: queue
      QUEUE_BULL_REDIS_HOST: redis
      QUEUE_BULL_REDIS_PORT: 6379
      QUEUE_BULL_REDIS_PASSWORD: ${REDIS_PASSWORD}
      DB_TYPE: postgresdb
      DB_POSTGRESDB_HOST: postgres
      DB_POSTGRESDB_DATABASE: ${PG_DB}
      DB_POSTGRESDB_USER: ${PG_USER}
      DB_POSTGRESDB_PASSWORD: ${PG_PASSWORD}
      DB_POSTGRESDB_SCHEMA: n8n
      N8N_ENCRYPTION_KEY: ${N8N_ENCRYPTION_KEY}
      N8N_HOST: n8n.${PUBLIC_DOMAIN}
      N8N_PROTOCOL: https
      WEBHOOK_URL: https://n8n.${PUBLIC_DOMAIN}/
      GENERIC_TIMEZONE: Europe/Madrid
    volumes: [n8n_data:/home/node/.n8n]
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_healthy }
    networks: [internal]

  n8n-webhook:
    image: n8nio/n8n:latest
    restart: unless-stopped
    command: ["webhook"]
    environment:  # mismas vars que n8n-main
      <<: *n8n-env
    networks: [internal]

  n8n-worker:
    image: n8nio/n8n:latest
    restart: unless-stopped
    command: ["worker"]
    environment:
      <<: *n8n-env
    networks: [internal]
    deploy:
      replicas: 2

  # Observabilidad (Sprint 3)
  prometheus:
    image: prom/prometheus
    restart: unless-stopped
    volumes:
      - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
    networks: [internal]

  grafana:
    image: grafana/grafana
    restart: unless-stopped
    environment:
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_PASSWORD}
    volumes: [grafana_data:/var/lib/grafana]
    networks: [internal]
```

## Caddyfile

```caddy
api.{$PUBLIC_DOMAIN} {
    reverse_proxy api:3000
    encode gzip
    log {
        output file /data/access-api.log
    }
}

n8n.{$PUBLIC_DOMAIN} {
    reverse_proxy n8n-main:5678
}

# Webhook URL pública SOLO si necesitas que ManyChat o terceros
# vayan directos a n8n. Mejor que vayan a la API.
hook.{$PUBLIC_DOMAIN} {
    reverse_proxy n8n-webhook:5678
}

# Admin (Sprint 3): incluye Bull Board, Grafana, dashboard custom
admin.{$PUBLIC_DOMAIN} {
    @grafana path /grafana/*
    handle @grafana {
        reverse_proxy grafana:3000
    }

    @queues path /queues/*
    handle @queues {
        reverse_proxy api:3000
    }

    handle {
        reverse_proxy api:3000
    }
}
```

## Variables de entorno (.env)

```bash
# Dominio
PUBLIC_DOMAIN=midominio.com

# Postgres
PG_USER=postgres
PG_PASSWORD=<generar>
PG_DB=stack

# Redis
REDIS_PASSWORD=<generar>

# Tokens
MC_WEBHOOK_TOKEN=<generar 32 bytes hex>
N8N_CALLBACK_TOKEN=<generar 32 bytes hex>
ADMIN_JWT_SECRET=<generar 64 bytes hex>
N8N_ENCRYPTION_KEY=<generar 32 bytes hex>

# Otros
GRAFANA_PASSWORD=<generar>
```

Generar secretos:
```bash
openssl rand -hex 32
```

## Init SQL (Postgres)

`postgres/init.sql` se ejecuta solo al primer arranque:

```sql
CREATE SCHEMA IF NOT EXISTS api;
CREATE SCHEMA IF NOT EXISTS n8n;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Usuario read-only para n8n
CREATE USER n8n_reader WITH PASSWORD '<misma password u otra>';
GRANT USAGE ON SCHEMA api TO n8n_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA api TO n8n_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA api GRANT SELECT ON TABLES TO n8n_reader;
```

Las migraciones de tablas de `api` las hace la API en cada deploy con una herramienta como **drizzle-kit** o **node-pg-migrate**. No usar Prisma migrate en producción si quieres simplicidad operativa.

## Deploy: flujo

```bash
# Primera vez en el VPS
git clone <repo> /opt/repos/manychat-debounce
cd /opt/stack
cp .env.example .env
# editar .env con secretos
docker compose up -d postgres redis    # primero los stateful
docker compose run --rm api npm run db:migrate
docker compose up -d                    # todo lo demás

# Updates
cd /opt/repos/manychat-debounce && git pull
cd /opt/stack
docker compose build api api-worker
docker compose run --rm api npm run db:migrate
docker compose up -d --force-recreate api api-worker
```

Recomendado tener un `Makefile` o `justfile` con estos comandos.

## Backups

Cron diario en el host:

```bash
# /opt/stack/scripts/backup.sh
#!/bin/bash
set -euo pipefail
TS=$(date +%Y%m%d-%H%M%S)
DIR=/opt/backups
mkdir -p "$DIR"

# Postgres
docker compose -f /opt/stack/docker-compose.yml exec -T postgres \
  pg_dump -U "$PG_USER" "$PG_DB" | gzip > "$DIR/pg-$TS.sql.gz"

# Redis (snapshot)
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" SAVE
docker cp $(docker compose ps -q redis):/data/dump.rdb "$DIR/redis-$TS.rdb"

# Cleanup > 30 días
find "$DIR" -mtime +30 -delete

# Upload a S3/B2/R2
rclone copy "$DIR" remote:backups/stack/
```

Cron: `0 4 * * * /opt/stack/scripts/backup.sh >> /var/log/backup.log 2>&1`

## Recursos mínimos VPS

| Carga | RAM | vCPU | Disco |
|---|---|---|---|
| MVP / dev | 4 GB | 2 | 40 GB SSD |
| Producción ligera (<5k msg/día) | 8 GB | 4 | 80 GB SSD |
| Producción media (5–50k msg/día) | 16 GB | 6 | 160 GB SSD |
| Producción alta (>50k msg/día) | 32 GB+ | 8+ | 320 GB+ SSD |

Hetzner CX31/CX41 cubre la mayoría de casos por <30€/mes.

## Hardening

- Firewall: solo 22 (SSH), 80, 443 abiertos al exterior. Resto bloqueado.
- SSH solo con clave, root deshabilitado.
- Fail2ban activado.
- `unattended-upgrades` para parches de seguridad del SO.
- Caddy gestiona TLS automático (Let's Encrypt).
- Postgres y Redis **nunca expuestos al exterior**, solo en red `internal` de Docker.
- Secrets nunca en el repo: `.env` en el host, no commiteado.
