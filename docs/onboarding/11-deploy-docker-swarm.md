# 11 · Docker Swarm y deploy

Un único VPS, todo en Docker Swarm. El repo `n8n-production-stack` es el punto de entrada único: instala Traefik, despliega n8n, y cuando la API esté lista la añade al mismo stack. Un solo `bash setup.sh` deja todo corriendo.

> **Fuente de verdad**: `docker-stack.yml` + `scripts/setup.sh` en el repo GitHub. La documentación refleja ese repo exactamente.

## Topología

```
VPS (Ubuntu 22.04 LTS)
│
├── /etc/traefik/
│   ├── traefik.yml          ← config estática (generada por setup.sh)
│   ├── acme.json            ← certificados Let's Encrypt
│   └── dynamic/             ← middlewares opcionales
│
├── /root/n8n-production/    ← repo único (stack + monorepo API)
│   ├── docker-stack.yml     ← definición completa del stack
│   ├── .env                 ← secretos (NO en git)
│   ├── scripts/
│   │   ├── setup.sh         ← instalación desde cero
│   │   ├── deploy.sh        ← actualización del stack
│   │   └── backup.sh        ← backup diario
│   ├── apps/api/            ← Fastify + BullMQ worker (Sprint 1+)
│   ├── packages/db/         ← drizzle schema + migrations
│   ├── packages/shared/     ← Zod schemas compartidos
│   ├── pnpm-workspace.yaml  ← workspaces pnpm
│   ├── package.json         ← scripts root (lint, typecheck, build, test)
│   ├── biome.json           ← lint + format
│   ├── tsconfig.base.json   ← TS estricto
│   ├── .github/workflows/   ← CI GitHub Actions
│   ├── docs/adr/            ← ADRs del stack
│   └── docs/               ← esta documentación (onboarding, adr, reference, status)
│
└── Docker Swarm (single-node manager)
    ├── Servicio: traefik      ← reverse proxy + TLS
    └── Stack: n8n
        ├── n8n-main           ← UI + API n8n
        ├── n8n-webhook        ← recibe webhooks externos
        ├── n8n-worker (×3)    ← ejecuta workflows
        ├── postgres           ← DB compartida (schemas: n8n + api)
        ├── redis              ← cola BullMQ + debounce state
        ├── minio              ← almacenamiento S3-compatible
        ├── minio-init         ← one-shot: crea bucket
        ├── api                ← Fastify (Sprint 1+)
        ├── api-worker         ← BullMQ worker (Sprint 1+)
        └── api-migrate        ← one-shot: drizzle migrate (Sprint 1+)
```

## Redes Docker

```
traefik-public (overlay, external)
  └── traefik, n8n-main, n8n-webhook, minio, api

n8n_n8n_internal (overlay, internal)
  └── todos los servicios del stack n8n
```

- **`traefik-public`**: red overlay creada por `setup.sh`. Solo servicios que necesitan estar expuestos al exterior se conectan aquí.
- **`n8n_internal`**: red interna del stack. Postgres, Redis y workers nunca se exponen al exterior.

## Traefik v2.11 — cómo funciona

Traefik es un **servicio Swarm independiente** (no parte del stack n8n, no Dokploy). Se instala una sola vez y persiste entre redeploys del stack.

```yaml
# /etc/traefik/traefik.yml (generado por setup.sh)
providers:
  docker:
    swarmMode: true
    network: traefik-public
    exposedByDefault: false
    watch: true

entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint: { to: websecure, scheme: https, permanent: true }
  websecure:
    address: ":443"

certificatesResolvers:
  letsencrypt:
    acme:
      email: <email>
      storage: /etc/traefik/acme.json
      httpChallenge:
        entryPoint: web
```

Los servicios del stack se exponen añadiendo **labels** en `docker-stack.yml`. Traefik los detecta automáticamente por el Docker socket.

> **Por qué v2.11 y no v3**: el provider Swarm de Traefik v3 usa Docker API 1.24 hardcodeada, incompatible con Docker Engine 28+. Traefik v2.11 negocia la versión correctamente.

## docker-stack.yml — servicios de la API (Sprint 1+)

Estos bloques se añaden al `docker-stack.yml` existente. Los servicios de n8n, Postgres, Redis y MinIO no cambian.

```yaml
  # ==========================================================
  # API — Fastify HTTP server (webhooks + admin endpoints)
  # ==========================================================
  api:
    image: ${API_IMAGE:-ghcr.io/revolicord/dm-api:latest}
    command: ["node", "dist/server.js"]
    networks:
      - n8n_internal
      - traefik_public
    environment:
      NODE_ENV: production
      PORT: 3000
      DATABASE_URL: postgres://n8n:${POSTGRES_PASSWORD}@postgres:5432/n8n?schema=api
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379/0
      MC_WEBHOOK_TOKEN: ${MC_WEBHOOK_TOKEN}
      N8N_CALLBACK_TOKEN: ${N8N_CALLBACK_TOKEN}
      N8N_BASE_URL: http://n8n-webhook:5678
      PUBLIC_API_URL: https://${API_HOST}
      ADMIN_JWT_SECRET: ${ADMIN_JWT_SECRET}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD}
      LOG_LEVEL: info
    depends_on:
      - postgres
      - redis
    healthcheck:
      test: ['CMD-SHELL', 'wget -qO- http://localhost:3000/healthz || exit 1']
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
    deploy:
      replicas: 1
      restart_policy:
        condition: on-failure
        delay: 10s
      placement:
        constraints:
          - node.role == manager
      labels:
        - "traefik.enable=true"
        - "traefik.docker.network=${TRAEFIK_NETWORK}"
        - "traefik.http.routers.api.rule=Host(`${API_HOST}`)"
        - "traefik.http.routers.api.entrypoints=websecure"
        - "traefik.http.routers.api.tls.certresolver=letsencrypt"
        - "traefik.http.routers.api.service=api-svc"
        - "traefik.http.services.api-svc.loadbalancer.server.port=3000"
        - "traefik.http.routers.api-http.rule=Host(`${API_HOST}`)"
        - "traefik.http.routers.api-http.entrypoints=web"
        - "traefik.http.routers.api-http.middlewares=redirect-to-https"

  # ==========================================================
  # API WORKER — BullMQ worker (procesa batches, fan-out a n8n)
  # Sin puertos HTTP, solo red interna
  # ==========================================================
  api-worker:
    image: ${API_IMAGE:-ghcr.io/revolicord/dm-api:latest}
    command: ["node", "dist/worker.js"]
    networks:
      - n8n_internal
    environment:
      NODE_ENV: production
      DATABASE_URL: postgres://n8n:${POSTGRES_PASSWORD}@postgres:5432/n8n?schema=api
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379/0
      N8N_CALLBACK_TOKEN: ${N8N_CALLBACK_TOKEN}
      N8N_BASE_URL: http://n8n-webhook:5678
      WORKER_CONCURRENCY: 10
      LOG_LEVEL: info
    depends_on:
      - postgres
      - redis
    healthcheck:
      test: ['CMD-SHELL', 'wget -qO- http://localhost:3000/healthz || exit 1']
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
    deploy:
      replicas: 1
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 5
      placement:
        constraints:
          - node.role == manager

  # ==========================================================
  # API MIGRATE — one-shot: aplica migraciones Drizzle
  # Se ejecuta en cada deploy antes de que api arranque
  # ==========================================================
  api-migrate:
    image: ${API_IMAGE:-ghcr.io/revolicord/dm-api:latest}
    command: ["node", "dist/scripts/migrate.js"]
    networks:
      - n8n_internal
    environment:
      DATABASE_URL: postgres://n8n:${POSTGRES_PASSWORD}@postgres:5432/n8n?schema=api
    depends_on:
      - postgres
    deploy:
      restart_policy:
        condition: none
      placement:
        constraints:
          - node.role == manager
```

## Variables de entorno — extensión del .env

Las variables de n8n ya están en el `.env`. Se añaden estas para la API:

```bash
# ---- API DM Setter ------------------------------------------
API_HOST=api.tudominio.com       # subdominio para Fastify
ADMIN_HOST=admin.tudominio.com   # subdominio para dashboard (Sprint 3)

# Tokens de autenticación (generados por setup.sh)
MC_WEBHOOK_TOKEN=<32 bytes hex>  # compartido con ManyChat header X-MC-Token
N8N_CALLBACK_TOKEN=<32 bytes hex># usado por n8n en POST /admin/turn-completed
ADMIN_JWT_SECRET=<64 bytes hex>  # firma JWT del dashboard
ADMIN_PASSWORD=<password>        # clave maestra del dashboard

# Imagen Docker de la API (se actualiza en cada release)
API_IMAGE=ghcr.io/revolicord/dm-api:latest
```

Generación en `setup.sh` (se añade a la sección de credenciales):
```bash
MC_WEBHOOK_TOKEN=$(openssl rand -hex 32)
N8N_CALLBACK_TOKEN=$(openssl rand -hex 32)
ADMIN_JWT_SECRET=$(openssl rand -hex 64)
ADMIN_PASSWORD=$(openssl rand -base64 16 | tr -d '/+=\n')
```

## Init SQL — schema api en Postgres

El Postgres del stack ya corre con el schema `n8n`. Al añadir la API, se necesita el schema `api` y un usuario read-only para n8n.

Crear `postgres/init-api.sql` que se monta como `initdb.d` o se ejecuta manualmente la primera vez:

```sql
-- Schema para la API (separado de n8n)
CREATE SCHEMA IF NOT EXISTS api;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Usuario read-only para que n8n consulte datos de la API
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'n8n_reader') THEN
    CREATE USER n8n_reader WITH PASSWORD 'CAMBIAR_EN_PRODUCCION';
  END IF;
END
$$;
GRANT USAGE ON SCHEMA api TO n8n_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA api TO n8n_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA api GRANT SELECT ON TABLES TO n8n_reader;
```

Las migraciones de tablas las aplica `api-migrate` en cada deploy con drizzle-kit. No se tocan manualmente.

## Flujo de instalación desde cero (VPS limpio)

```bash
# 1. Clonar el repo
git clone https://github.com/revolicord/n8n-production-stack /root/n8n-production
cd /root/n8n-production

# 2. Ejecutar setup — pide email + dominios, genera todo lo demás
bash scripts/setup.sh

# El script hace automáticamente:
# ✓ Verifica Docker instalado
# ✓ Activa Docker Swarm si no está activo
# ✓ Crea red overlay traefik-public
# ✓ Instala Traefik v2.11 con Let's Encrypt
# ✓ Genera todas las contraseñas y claves
# ✓ Escribe .env
# ✓ docker stack deploy -c docker-stack.yml n8n
```

Lo que el usuario ingresa manualmente:
- Email para Let's Encrypt
- Subdominio n8n (ej: `paneln8n.tudominio.com`)
- Subdominio MinIO S3 (ej: `minio.tudominio.com`)
- Subdominio MinIO Console (ej: `minio-console.tudominio.com`)
- Subdominio API (ej: `api.tudominio.com`) — cuando se añada la API en Sprint 1

Todo lo demás (contraseñas, claves de cifrado, tokens) se genera con `openssl rand`.

## Flujo de actualización del stack

```bash
# Actualizar n8n o la API a nueva versión
cd /root/n8n-production
git pull

# Si hay nuevas variables en .env.example, añadirlas al .env
diff .env.example .env

# Redeploy (zero-downtime en servicios con replicas > 1)
make deploy
# equivale a: docker stack deploy --with-registry-auth -c docker-stack.yml n8n
```

Para la API específicamente (build desde la raíz del monorepo):
```bash
cd /root/n8n-production
docker build \
  -t ghcr.io/revolicord/dm-api:latest \
  -f apps/api/Dockerfile \
  .
docker push ghcr.io/revolicord/dm-api:latest

# En el servidor: forzar pull de nueva imagen
docker service update --image ghcr.io/revolicord/dm-api:latest n8n_api
docker service update --image ghcr.io/revolicord/dm-api:latest n8n_api-worker
```

## Comandos operativos

```bash
make status              # estado de todos los servicios del stack
make logs-main           # logs de n8n-main
make logs-worker         # logs de n8n-worker
make logs-api            # logs de api (Sprint 1+)
make scale-workers N=5   # escalar n8n-workers a 5 réplicas
make scale-api N=2       # escalar api a 2 réplicas
make backup              # backup manual Postgres + Redis
make down                # parar el stack (datos seguros en volúmenes)

# Diagnóstico
docker service ps n8n_api --no-trunc   # ver fallos de la API
docker service logs n8n_api -f --tail 100
docker service logs n8n_api-worker -f --tail 100

# Migración manual de emergencia
docker run --rm \
  --network n8n_n8n_internal \
  -e DATABASE_URL="postgres://n8n:${POSTGRES_PASSWORD}@postgres:5432/n8n?schema=api" \
  ghcr.io/revolicord/dm-api:latest \
  node dist/scripts/migrate.js
```

## Backup

```bash
# /root/n8n-production/scripts/backup.sh
#!/bin/bash
set -euo pipefail
TS=$(date +%Y%m%d-%H%M%S)
DIR=/root/backups
mkdir -p "$DIR"

source /root/n8n-production/.env

# Postgres — dump completo (schemas n8n + api)
docker run --rm \
  --network n8n_n8n_internal \
  -e PGPASSWORD="$POSTGRES_PASSWORD" \
  postgres:16-alpine \
  pg_dump -h postgres -U n8n n8n | gzip > "$DIR/pg-$TS.sql.gz"

# Redis — snapshot
docker exec $(docker ps -q -f name=n8n_redis) \
  redis-cli -a "$REDIS_PASSWORD" SAVE
REDIS_CONTAINER=$(docker ps -q -f name=n8n_redis)
docker cp "$REDIS_CONTAINER":/data/dump.rdb "$DIR/redis-$TS.rdb"

# Cleanup > 30 días
find "$DIR" -mtime +30 -delete

echo "Backup completado: $TS"
```

Cron diario a las 4am (en el host):
```bash
0 4 * * * /root/n8n-production/scripts/backup.sh >> /var/log/n8n-backup.log 2>&1
```

## Recursos mínimos VPS

| Carga | RAM | vCPU | Disco |
|---|---|---|---|
| Sprint 0-1 (dev/test) | 4 GB | 2 | 40 GB SSD |
| Producción ligera (<5k msg/día) | 8 GB | 4 | 80 GB SSD |
| Producción media (5–50k msg/día) | 16 GB | 6 | 160 GB SSD |

Hetzner CX22/CX32 cubre Sprint 0-1 por <15€/mes.

## Hardening

- Firewall ufw: solo 22 (SSH con clave), 80 y 443. Todo lo demás bloqueado.
- SSH: solo clave, root deshabilitado, fail2ban activo.
- Traefik gestiona TLS automático (Let's Encrypt). HSTS activado.
- Postgres y Redis **nunca expuestos al exterior**: solo en red `n8n_internal`.
- Secrets en `.env` en el host, nunca commiteados (`.gitignore` riguroso).
- `unattended-upgrades` para parches de seguridad del SO.
