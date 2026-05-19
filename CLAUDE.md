# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A production-grade **n8n automation platform** plus a **DM Setter API** — a Fastify service that sits between ManyChat Instagram DM webhooks and n8n AI agent workflows. Messages are debounced, batched, and dispatched; n8n handles all LLM/agent logic.

## Commands

### Development (monorepo — pnpm workspaces)

```bash
pnpm install
pnpm dev:api          # Fastify HTTP on port 3000 (tsx watch)
pnpm dev:worker       # BullMQ worker (tsx watch)

pnpm lint             # Biome check
pnpm lint:fix         # Biome check --write
pnpm typecheck        # tsc across all packages
pnpm test             # vitest across all packages
pnpm build            # tsup across all packages
```

### Database (Drizzle — `packages/db/`)

```bash
pnpm db:generate      # generate migration from schema.ts
pnpm db:migrate       # apply pending migrations
pnpm db:studio        # Drizzle Studio UI
```

Migrations live in `packages/db/drizzle/`. **Never edit an already-applied migration** — create a new one.

### Infrastructure (Docker Swarm)

```bash
make deploy           # deploy or update the full stack
make status           # service status
make logs-main        # n8n main UI logs
make logs-webhook     # n8n webhook processor logs
make logs-worker      # n8n worker logs
make logs-api         # DM API logs
make logs-api-worker  # BullMQ worker logs
make scale-workers N=5
make rebuild-api      # build dm-api:local image and force-update services
make migrate          # run drizzle migrations via one-shot container
make seed-tenant SLUG=dev N8N_WORKFLOW_URL=https://...
make backup           # PostgreSQL + MinIO backup
make down             # remove stack (volumes persist)
```

### First-time setup

```bash
bash scripts/setup.sh   # interactive: domains, SSL email, credentials, Swarm init
```

## Architecture

### Infrastructure layer (`docker-stack.yml`)

Docker Swarm stack with five services:
- **Traefik v3.3** — TLS termination + routing. Webhooks (`/webhook/*`) go to `n8n-webhook` (priority 10); all other traffic goes to `n8n-main`.
- **n8n-main** — n8n UI + REST API
- **n8n-webhook** — dedicated webhook processor replicas
- **n8n-worker** — queue workers (Bull/Redis), default 3 replicas
- **PostgreSQL 16**, **Redis 7**, **MinIO** — storage services

Two overlay networks: `n8n_internal` (services talk to each other) and `traefik_public` (external traffic).

### Application layer (monorepo)

```
apps/api/src/
  server.ts           # Fastify entry — registers plugins + routes
  worker.ts           # BullMQ worker entry
  config.ts           # Zod-validated env — always use getConfig(), never process.env directly
  routes/
    webhook-manychat.ts   # POST /webhook/manychat — main inbound path
    tools.ts              # GET /tools — returns flows/tools for n8n Build Context
    admin/
      turn-completed.ts   # POST /admin/turn-completed — n8n calls this to close a turn
      set-stage.ts        # POST /admin/set-stage — n8n calls this to advance lead stage
  services/
    debounce.ts       # Lua atomic: RPUSH buffer + SET debounce token + SET first_msg
    lock.ts           # Redis lock for turn exclusivity
    dispatch-n8n.ts   # HTTP POST to n8n workflow webhook
    subscribers.ts / tenants.ts / turns.ts / messages.ts / conversations.ts / lead-stages.ts
  lib/
    redis.ts          # singleton ioredis client
    db.ts             # singleton drizzle client
    logger.ts         # pino JSON logger
    auth.ts           # token validation
    redis-keys.ts     # centralised key templates

packages/
  db/src/schema.ts    # all Drizzle table definitions (pgSchema 'api')
  shared/src/schemas/ # Zod schemas shared between API and n8n dispatch types

n8n/                  # n8n workflow docs + node reference code
  README.md           # workflow setup checklist + node map
  nodes/              # JS code for Code nodes (Build Context, Prepare Callback)
  system-prompt.md    # AI agent system prompt
  stages.md           # funnel stage definitions + flows_by_stage config
  flows-catalog.md    # ManyChat flow name → namespace mapping
```

### Message flow

```
ManyChat → POST /webhook/manychat
  → auth + idempotency check (SHA-256 hash, Redis SET NX)
  → upsert subscriber + persist raw message (Postgres)
  → Lua atomic debounce (Redis buffer RPUSH + debounce timer reset)
  → BullMQ job scheduled after DEBOUNCE_MS (default 15 s)
  → worker fires → acquire turn lock → drain buffer → POST n8n /webhook/agent-run
      n8n: Build Context → AI Agent (Claude Sonnet 4.6) → send ManyChat response
      n8n: → POST /admin/turn-completed  ← releases lock + persists metrics
```

## Critical rules

### Code vs. n8n boundary
The most important design decision. See `docs/04_SYSTEM_MAP.md` (archived original: `docs/_archive/docs-dm-settings/02-frontera-codigo-vs-n8n.md`).
- **Fastify code**: auth, idempotency, rate-limit, debounce, lock, BullMQ, DB mutations
- **n8n**: prompts, LLM selection, tools, memory, ManyChat API calls, business routing

Never put LLM calls or prompt logic in TypeScript. Never put debounce/lock logic in n8n.

### Multi-tenancy
Every new table needs `tenant_id UUID NOT NULL`. Every Redis key uses a `{tenant_id}:` prefix (see `lib/redis-keys.ts`). Every query filters by tenant.

### Logging
Use `pino` via `lib/logger.ts`. Never `console.log`. Never log raw webhook bodies (PII risk).

### Idempotency
Webhooks: SHA-256 hash → Redis SET NX. BullMQ jobs: deterministic `jobId` where applicable.

### Env vars
All env vars are declared in `.env.example` and validated by Zod in `apps/api/src/config.ts` at startup. Never read `process.env.X` directly — use `getConfig()`.

### No `any`
`noExplicitAny` is a Biome error. TypeScript config has `strict: true` + `noUncheckedIndexedAccess: true`.

### New dependencies
Require an ADR in `docs/adr/` before adding packages outside the established stack (Fastify, BullMQ, Drizzle, Redis, Zod, pino, vitest).

## Commit convention

Conventional Commits: `feat(api):`, `fix(worker):`, `refactor(debounce):`, `docs(adr):`, `test(debounce):`, `chore(deps):`.

CI runs lint + typecheck + build + test on every push (`.github/workflows/ci.yml`). Never commit without these passing locally.
