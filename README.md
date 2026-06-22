# n8n Production Stack — DM Setter API

Plataforma de automatización de Instagram DMs. Combina **n8n** como motor de workflows con una **API Fastify** (debounce, BullMQ, multi-tenancy) y un **agente LangGraph** (Claude Sonnet 4.6) que conduce la conversación y avanza leads por el funnel de ventas.

---

## Arquitectura

```
ManyChat DM (Instagram)
  │
  ▼
POST /webhook/manychat  (Fastify API — auth, idempotencia, rate-limit)
  │
  ▼ Lua atomic
Redis debounce buffer ──── BullMQ job (tras DEBOUNCE_MS)
  │
  ▼ turn lock
apps/agent  (LangGraph + Claude Sonnet 4.6)
  ├─ assemble_context → prepare_prompt → understand
  ├─ flow_engine (CALM declarativo) → execute_actions
  └─ respond → POST /admin/turn-completed
         │
         ├─ ManyChat: sendFlow / sendContent / sendText
         └─ Postgres: turns, agent_turn_traces, lead_stages

Calendly (invitee.created)
  │
  └─ POST /webhook/calendly → persiste booking → ChangeStage(→D, cascade)

Telegram (escalado a humano)
  └─ POST /webhook/telegram → callbacks de botones inline
```

### Servicios Docker (Swarm)

| Servicio | Imagen | Rol |
|----------|--------|-----|
| `n8n-main` | `n8nio/n8n` | Panel UI + credenciales + scheduler |
| `n8n-webhook` | `n8nio/n8n` | Receptor de webhooks n8n (prioridad alta) |
| `n8n-worker` ×3 | `n8nio/n8n` | Ejecución de workflows en cola Bull |
| `api` | `dm-api:local` | Fastify HTTP: webhooks ManyChat / Calendly / Telegram |
| `api-worker` | `dm-api:local` | BullMQ worker: debounce → agent → dispatch |
| `dashboard` | `dm-dashboard:local` | Panel Next.js de métricas y configuración |
| `postgres` | `postgres:16` | Base de datos principal |
| `redis` | `redis:7` | Colas BullMQ, debounce, locks, idempotencia |
| `minio` | `minio/minio` | Almacenamiento S3 para activos de followups |

### Routing Traefik v2.11

| Dominio | Servicio |
|---------|---------|
| `panel.tudominio.com` | n8n UI (prioridad 1) + `/webhook/*` → n8n-webhook (prioridad 10) |
| `api.tudominio.com` | API DM Setter |
| `dashboard.tudominio.com` | Dashboard analítico |
| `minio.tudominio.com` | MinIO S3 API |
| `minio-console.tudominio.com` | MinIO consola web |

---

## Estructura del monorepo

```
apps/
  api/          Fastify HTTP server + BullMQ worker
    src/
      server.ts           Fastify entry
      worker.ts           BullMQ worker entry
      config.ts           Zod-validated env
      routes/
        webhook-manychat.ts   POST /webhook/manychat
        webhook-calendly.ts   POST /webhook/calendly
        webhook-telegram.ts   POST /webhook/telegram
        tools.ts              GET /tools (contexto para n8n)
        admin/
          turn-completed.ts   POST /admin/turn-completed
          set-stage.ts        POST /admin/set-stage
      services/             debounce, lock, turns, subscribers…
      lib/                  redis, db, logger, redis-keys

  agent/        Motor de diálogo LangGraph (ADR-0024/0025)
    src/
      run-turn.ts           Entrada principal (runTurn)
      graph/build-graph.ts  Grafo LangGraph compilado
      core/                 LLM client (wrapAnthropic), engine CALM
      services/             traces, dialogue-states, context-queries
      channel/              Adapters: ManyChat, dry-run
      scripts/              cutover, seed-agent-config, prune-traces, replay

  dashboard/    Panel analítico Next.js 15
    /settings   Configuración de tenant (funnel, flows, persona, followups)
    /           Kanban de prospectos y métricas

packages/
  db/           Drizzle ORM — schema `api`, migrations, seeds
  shared/       Zod schemas y tipos compartidos

scripts/
  setup.sh                  Instalación interactiva completa
  deploy.sh                 Redeploy del stack
  backup.sh                 Backup PostgreSQL + MinIO
  telegram-set-webhook.sh   Registra webhook de callbacks Telegram
  calendly-set-webhook.sh   Registra suscripción webhook Calendly
  init-minio-bucket.sh      Crea buckets MinIO

docs/
  DEPLOYMENT.md             ← Guía completa de despliegue en servidor nuevo
  adr/                      Decisiones arquitecturales (ADR-0001 a 0025)
  n8n/                      Especificación de workflows n8n
  api/                      Documentación de rutas y contratos
```

---

## Desarrollo local

```bash
pnpm install

pnpm dev:api       # Fastify HTTP en puerto 3000 (tsx watch)
pnpm dev:worker    # BullMQ worker (tsx watch)

pnpm lint          # Biome check
pnpm lint:fix      # Biome check --write
pnpm typecheck     # tsc en todos los paquetes
pnpm test          # vitest en todos los paquetes
pnpm build         # tsup en todos los paquetes
```

### Base de datos (Drizzle)

```bash
pnpm db:generate   # genera migración desde schema.ts
pnpm db:migrate    # aplica migraciones pendientes
pnpm db:studio     # Drizzle Studio UI
```

Las migraciones viven en `packages/db/drizzle/`. **No editar una migración ya aplicada** — crear una nueva.

### Smoke test

```bash
pnpm smoke:manychat
# Envía texto, flows, followups y notificación Telegram contra la API
# Diagnostica fallos de código vs API externa
```

---

## Despliegue en producción

Ver **[DEPLOYMENT.md](DEPLOYMENT.md)** para la guía completa:
- Requisitos de servidor y DNS
- Cuentas externas necesarias (Anthropic, GitHub, ManyChat, Telegram, Calendly)
- Instalación paso a paso con `bash scripts/setup.sh`
- Post-instalación: ManyChat, Calendly, Telegram, MinIO, LangSmith
- Onboarding de tenants, operaciones y troubleshooting

**Resumen rápido** (servidor Ubuntu 22.04, Docker instalado, DNS configurado):

```bash
git clone https://github.com/revolicord/n8n-production-stack.git /root/n8n-production-stack
cd /root/n8n-production-stack
bash scripts/setup.sh   # guía interactiva ~10 min
```

### DNS requerido (antes de instalar)

```
# Un solo A record → IP del servidor
server.tudominio.com       A      1.2.3.4

# CNAMEs para cada servicio
panel.tudominio.com        CNAME  server.tudominio.com
api.tudominio.com          CNAME  server.tudominio.com
dashboard.tudominio.com    CNAME  server.tudominio.com
minio.tudominio.com        CNAME  server.tudominio.com
minio-console.tudominio.com CNAME server.tudominio.com
```

### Comandos habituales en producción

```bash
make status              # estado de todos los servicios
make logs-api-worker     # logs del procesamiento de mensajes (más importante)
make logs-api            # logs de webhooks entrantes
make logs-main           # logs del panel n8n
make rebuild-api         # reconstruir y redesplegar API + agent
make rebuild-dashboard   # reconstruir y redesplegar dashboard
make migrate             # aplicar migraciones Drizzle pendientes
make scale-workers N=5   # escalar workers n8n a 5 réplicas
make backup              # backup manual PostgreSQL + MinIO
make seed-tenant SLUG=x N8N_WORKFLOW_URL=https://...   # crear tenant
make seed-agent-config SLUG=x                           # importar flows + persona
make export-conversation CONV=<uuid>                    # exportar para tuning
make prune-traces DAYS=30                               # limpiar trazas antiguas
```

---

## Observabilidad

### Trazas de negocio — siempre activas

Cada turno del agente queda en `api.agent_turn_traces`:

```sql
SELECT mode, status, reasoning, flow_path, response_texts, metrics, error
FROM api.agent_turn_traces
WHERE tenant_id = '<uuid>'
ORDER BY created_at DESC
LIMIT 20;
```

Visible también en `https://dashboard.tudominio.com`.

### Trazas técnicas — LangSmith (opcional)

`LANGSMITH_TRACING=true` en `.env` activa el envío automático al proyecto `dm-agent`.
Muestra el grafo LangGraph completo: nodos, call al LLM, tokens y latencia.

> Usar siempre variables `LANGSMITH_*`. Las antiguas `LANGCHAIN_*` se ignoran silenciosamente.

---

## Reglas críticas del código

### Frontera código / n8n (ADR-0001)

| Fastify/TypeScript | n8n + agente |
|-------------------|--------------|
| auth, idempotencia, rate-limit | prompts, selección de LLM |
| debounce Lua, turn lock | tools, memoria, rutas de ManyChat |
| BullMQ jobs | lógica de negocio / reglas de funnel |
| DB mutations (stages, bookings) | — |

Nunca poner LLM calls en TypeScript. Nunca poner debounce/lock en n8n.

### Multi-tenancy

- Toda tabla nueva requiere `tenant_id UUID NOT NULL`
- Toda clave Redis usa prefijo `{tenant_id}:`  (ver `lib/redis-keys.ts`)
- Toda query filtra por tenant

### Otras reglas

- **Logging:** `pino` vía `lib/logger.ts`. Nunca `console.log`. Nunca loguear bodies de webhook (PII).
- **Env vars:** siempre `getConfig()`, nunca `process.env.X` directo.
- **TypeScript:** `strict: true` + `noUncheckedIndexedAccess`. Sin `any`.
- **Migraciones:** nunca editar una ya aplicada — crear una nueva.
- **Dependencias nuevas:** requieren ADR en `docs/adr/` antes de instalar.

---

## Commits

Conventional Commits: `feat(api):`, `fix(worker):`, `refactor(agent):`, `docs(adr):`, `test(debounce):`, `chore(deps):`.

CI en cada push: lint + typecheck + build + test (`.github/workflows/ci.yml`).

---

## ADRs relevantes

| ADR | Decisión |
|-----|---------|
| [0001](docs/adr/0001-arquitectura-general.md) | Arquitectura general y frontera código/n8n |
| [0003](docs/adr/0003-almacenamiento-minio.md) | MinIO para binarios y activos |
| [0004](docs/adr/0004-proxy-traefik.md) | Traefik v2.11 como reverse proxy |
| [0005](docs/adr/0005-webhooks-manychat.md) | Integración webhooks ManyChat |
| [0010](docs/adr/0010-funnel-stages-en-postgres.md) | Funnel stages en Postgres |
| [0016](docs/adr/0016-flow-registry-naming.md) | Convención `QC_{ETAPA}_{MEDIO}_{DESC}` |
| [0018](docs/adr/0018-followup-messages-minio-assets.md) | Activos de followups en MinIO |
| [0021](docs/adr/0021-consolidate-admin-panel-settings.md) | Panel `/settings` unificado |
| [0024](docs/adr/0024-motor-dialogo-declarativo-agnostico.md) | Motor de diálogo declarativo (CALM) |
| [0025](docs/adr/0025-langgraph-orquestacion-y-observabilidad.md) | LangGraph + LangSmith observabilidad |
