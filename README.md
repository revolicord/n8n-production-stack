# Instagram DM Setter

Plataforma de *appointment setting* por Instagram DM. Un agente de IA (**Claude Sonnet 4.6**) atiende a los leads que entran por DM, los lleva por las etapas de un funnel y los empuja hasta que **agendan una llamada de discovery**. Si un lead deja de responder, unos crons le envían follow-ups automáticos de los que el agente es consciente vía su memoria.

```
Instagram DM ─► ManyChat ─► DM Setter API (Fastify)    ─► n8n (modo cola)       ─► PostgreSQL
                            auth · idempotencia            agente IA Sonnet 4.6     fuente de verdad
                            debounce · turnos · BullMQ     tools · memoria · funnel
```

Dos capas en un mismo VPS (Docker Swarm):

- **Stack de infraestructura** — Traefik, n8n (main/webhook/worker), PostgreSQL, Redis, MinIO.
- **Monorepo de aplicación** — la DM Setter API (Fastify + worker BullMQ) que hace de puente entre ManyChat y n8n. La inteligencia (prompt, modelo, tools, memoria) vive en n8n, **no** en TypeScript.

**Empieza por [`docs/README.md`](docs/README.md)** para la documentación completa, y por [`docs/status.md`](docs/status.md) para saber qué funciona hoy y qué falta.

## Arquitectura del stack

```
Internet (HTTP/HTTPS)
       │
       ▼
  Traefik v2.11  — TLS automático Let's Encrypt
       │
       ├── <API_HOST>/webhook/manychat → DM Setter API (Fastify)
       ├── <N8N_HOST>/webhook/*        → n8n-webhook  (prioridad 10)
       ├── <N8N_HOST>/*                → n8n-main     (UI + API, prioridad 1)
       ├── <MINIO_DOMAIN>              → MinIO S3 API
       └── <MINIO_CONSOLE_DOMAIN>      → MinIO Console
                   │
             [Redis Queue - Bull]
             /      |      \
       [worker] [worker] [worker]   ← n8n-workers, escalables
             \      |      /
          [PostgreSQL] [MinIO]
```

> **Traefik v2.11, no v3**: el provider Swarm de Traefik v3 usa una versión de la Docker API incompatible con Docker Engine 28+. Ver [`docs/onboarding/11-deploy-docker-swarm.md`](docs/onboarding/11-deploy-docker-swarm.md).

## Monorepo de aplicación

```
apps/api/         ← Fastify HTTP + worker BullMQ (DM Setter API)
packages/db/      ← drizzle schema + migraciones (schema 'api' en Postgres)
packages/shared/  ← Zod schemas compartidos
n8n/              ← referencia de los workflows y nodos de n8n (agente)
```

```bash
# Desarrollo local
pnpm install
pnpm dev:api          # Fastify con tsx watch (puerto 3000)
pnpm dev:worker       # worker BullMQ con tsx watch

# Calidad
pnpm lint
pnpm typecheck
pnpm test
pnpm build

# Base de datos (drizzle)
pnpm db:generate      # genera migración desde packages/db/src/schema.ts
pnpm db:migrate       # aplica migraciones
pnpm db:studio        # drizzle studio
```

CI corre lint + typecheck + build + test en cada push (`.github/workflows/ci.yml`).

## Prerequisitos (deploy)

- [ ] Servidor con Ubuntu 22.04 o Debian 12
- [ ] Docker instalado (`curl -fsSL https://get.docker.com | sh`)
- [ ] Puertos 80 y 443 abiertos en el firewall
- [ ] Registros DNS apuntando a la IP del servidor (n8n, API, MinIO, MinIO console)

## Instalación desde cero (una sola vez)

```bash
git clone <URL-DEL-REPO> /root/n8n-production
cd /root/n8n-production
chmod +x scripts/*.sh
bash scripts/setup.sh
```

El script `setup.sh` pide dominios y email para SSL, genera credenciales y el `.env`, inicializa Docker Swarm, instala Traefik v2.11 con Let's Encrypt y despliega el stack.

## Operaciones habituales

```bash
make deploy             # desplegar o actualizar el stack completo
make status             # estado de todos los servicios
make logs-main          # logs de n8n-main (UI)
make logs-webhook       # logs del receptor de webhooks
make logs-worker        # logs de los n8n-workers
make logs-api           # logs de la DM Setter API
make logs-api-worker    # logs del worker BullMQ
make scale-workers N=5  # escalar n8n-workers
make rebuild-api        # rebuild de la imagen dm-api:local y force-update
make migrate            # correr migraciones drizzle (contenedor one-shot)
make backup             # backup de PostgreSQL + MinIO
make down               # parar el stack (datos seguros en volúmenes)
```

## Backup automático (cron diario)

```bash
crontab -e
# Añadir:
0 4 * * * /root/n8n-production/scripts/backup.sh >> /var/log/n8n-backup.log 2>&1
```

## Documentación

- [`docs/README.md`](docs/README.md) — índice y orden de lectura.
- [`docs/status.md`](docs/status.md) — qué funciona y qué falta.
- [`docs/onboarding/`](docs/onboarding/) — la secuencia conceptual (01–14).
- [`docs/adr/`](docs/adr/) — Architecture Decision Records (0001–0016).
- [`CLAUDE.md`](CLAUDE.md) — reglas operativas para trabajar en el código.

## Troubleshooting

**n8n no responde / Traefik da 404**
```bash
docker stack services n8n
docker service update --force traefik
```

**Certificados SSL no se generan** — los dominios deben apuntar al servidor ANTES de arrancar Traefik:
```bash
dig +short <N8N_HOST>
docker service update --force traefik
```

**Workers no procesan jobs**
```bash
make logs-worker        # n8n-workers
make logs-api-worker    # worker BullMQ de la API
make status
```
