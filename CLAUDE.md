# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A production-grade **Instagram DM Setter** built almost entirely in TypeScript. The primary stack is:

- **`apps/api`** (Fastify + BullMQ) — receives ManyChat / Calendly / Telegram webhooks, handles debounce, turn locks, idempotency, queuing, and all DB mutations.
- **`apps/agent`** (LangGraph + Claude Sonnet 4.6) — the AI brain: assembles context, runs the CALM declarative flow engine, calls the LLM, executes actions (sends flows/texts/media via ManyChat), and handles human escalation.
- **`apps/dashboard`** (Next.js 15) — analytics panel + `/settings` self-service config for funnel stages, flows, persona, and followups.
- **n8n** — present in infrastructure but **legacy only**. Active for tenants still on `engine='n8n'`; not the development path. All new logic goes in TypeScript.

`tenant.config.engine` controls dispatch per tenant:
- **`'agent'`** (default for new tenants) → `dispatchToAgent()` → `apps/agent` (synchronous, in-process)
- **`'n8n'`** (legacy) → `dispatchToN8n()` → n8n webhook (async, n8n calls back `/admin/turn-completed`)

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
pnpm smoke:manychat   # end-to-end smoke test: text / flows / followups / Telegram
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
make deploy                # deploy or update the full stack
make status                # service status
make logs-main             # n8n main UI logs
make logs-webhook          # n8n webhook processor logs
make logs-worker           # n8n worker logs
make logs-api              # DM API logs
make logs-api-worker       # BullMQ worker logs (most important — agent runs here)
make logs-dashboard        # Next.js dashboard logs
make scale-workers N=5     # scale n8n workers
make scale-api N=2         # scale api + api-worker together
make rebuild-api           # build dm-api:local and force-update api + api-worker
make rebuild-dashboard     # build dm-dashboard:local and force-update dashboard
make migrate               # run drizzle migrations via one-shot container
make seed-tenant SLUG=x N8N_WORKFLOW_URL=https://...   # create first tenant
make seed-agent-config SLUG=x                          # import flows + persona from seeds/
make cutover-agent SLUG=x                              # Phase 4 ADR-0024: init dialogue_states
make export-conversation CONV=<uuid>                   # export conversation bundle for tuning
make prune-traces DAYS=30                              # delete agent_turn_traces older than N days
make backup                # PostgreSQL + MinIO backup
make down                  # remove stack (volumes persist)
```

### First-time setup

```bash
bash scripts/setup.sh   # interactive: domains, SSL, Telegram, Calendly, Anthropic, LangSmith
```

## Architecture

### Infrastructure layer (`docker-stack.yml`)

Docker Swarm stack — 9 long-running services + 2 one-shot services:

| Service | Image | Role |
|---------|-------|------|
| `n8n-main` | `n8nio/n8n` | n8n UI + REST API + scheduler |
| `n8n-webhook` | `n8nio/n8n` | Dedicated webhook receiver (priority 10 in Traefik) |
| `n8n-worker` ×3 | `n8nio/n8n` | Bull/Redis queue workers for n8n workflows |
| `api` | `dm-api:local` | Fastify HTTP: ManyChat / Calendly / Telegram webhooks |
| `api-worker` | `dm-api:local` | BullMQ worker: debounce → lock → dispatch to agent/n8n |
| `dashboard` | `dm-dashboard:local` | Next.js 15 analytics + `/settings` config panel |
| `postgres` | `postgres:16-alpine` | Primary database (schema `api` + n8n tables) |
| `redis` | `redis:7-alpine` | BullMQ queues, debounce buffers, turn locks, idempotency |
| `minio` | `minio/minio` | S3-compatible storage for followup assets |
| `api-migrate` *(one-shot)* | `dm-api:local` | Applies Drizzle migrations before api starts |
| `minio-init` *(one-shot)* | `minio/mc` | Creates buckets (n8n-data, assets) on first deploy |

**Traefik v2.11** routing:
- `panel.tudominio.com` → n8n-main (priority 1) + `/webhook/*` → n8n-webhook (priority 10)
- `api.tudominio.com` → api:3000
- `dashboard.tudominio.com` → dashboard:3000
- `minio.tudominio.com` → minio:9000
- `minio-console.tudominio.com` → minio:9001

Two overlay networks: `n8n_internal` (service-to-service) and `traefik_public` (external traffic).

### Application layer (monorepo)

```
apps/api/src/
  server.ts               # Fastify entry — registers plugins + routes
  worker.ts               # BullMQ worker entry — registers all job processors + schedulers
  config.ts               # Zod-validated env — always use getConfig(), never process.env directly
  routes/
    webhook-manychat.ts   # POST /webhook/manychat — main inbound path
    webhook-calendly.ts   # POST /webhook/calendly — booking created/canceled events
    webhook-telegram.ts   # POST /webhook/telegram — inline button callback handler
    tools.ts              # GET /tools — flow/tool list for n8n Build Context
    health.ts             # GET /healthz
    index.ts              # route registration
    admin/
      turn-completed.ts        # POST /admin/turn-completed — n8n calls this when done
      set-stage.ts             # POST /admin/set-stage — manual stage override
      system-event.ts          # POST /admin/system-event — inject system messages
      notify-human.ts          # POST /admin/notify-human — trigger Telegram escalation
      pause.ts                 # POST /admin/pause / /admin/resume — subscriber pause
      followups.ts             # GET|POST /admin/followups — followup template CRUD
      followup-messages.ts     # GET|POST /admin/followup-messages — followup content CRUD
      flow-definitions.ts      # GET|POST /admin/flow-definitions — ManyChat flow registry
      agent-resources.ts       # GET|PUT /admin/agent-resources — agent persona/config
      agent-metrics.ts         # GET /admin/agent-metrics — turn metrics
      booking-reminders.ts     # GET|POST /admin/booking-reminders — reminder config
      notifications.ts         # GET /admin/notifications — notification log
      stage-transitions-map.ts # GET|PUT /admin/stage-transitions-map — funnel transitions
      tenants.ts               # GET|POST /admin/tenants — tenant CRUD
      assets.ts                # POST /admin/assets — MinIO upload
  services/
    debounce.ts           # Lua atomic: RPUSH buffer + SET debounce token + first_msg
    lock.ts               # Redis lock for turn exclusivity
    dispatch-agent.ts     # Lazy-import @dm-api/agent → runTurn() [engine='agent']
    dispatch-n8n.ts       # HTTP POST to n8n workflow webhook [engine='n8n']
    subscribers.ts / tenants.ts / turns.ts / messages.ts / conversations.ts
    lead-stages.ts / lead-crons.ts / bookings.ts
    followups.ts / followup-messages.ts / followup-render.ts
    notifications.ts / flow-definitions.ts / agent-resources.ts
    stage-transitions-map.ts / manychat-sync.ts / resume-agent.ts / idempotency.ts
  workers/
    process-batch.ts      # Core: token check → lock → drain buffer → dispatch agent/n8n
    followup-runner.ts    # Scheduled: advance followup sequences for due leads
    notify.ts             # Async: send Telegram notifications after escalation
    pause-reminder.ts     # Scheduled: remind via Telegram about paused leads
  lib/
    redis.ts              # singleton ioredis client
    db.ts                 # singleton drizzle client
    logger.ts             # pino JSON logger
    auth.ts               # ManyChat webhook token validation
    admin-auth.ts         # Dashboard/admin JWT validation
    redis-keys.ts         # centralised key templates
    telegram.ts           # Telegram Bot API client
    minio.ts              # MinIO client + presigned URL helpers
    openapi.ts            # Fastify OpenAPI/Swagger plugin
    queue.ts              # BullMQ queue definitions
    idempotency-hash.ts   # SHA-256 idempotency hash helpers

apps/agent/src/           # LangGraph agent (ADR-0024/0025) — engine='agent' path
  run-turn.ts             # Entry: runTurn(TurnInput) → AgentResponse
  resume.ts               # Resume conversation from LangGraph checkpoint
  config.ts               # Zod config: ANTHROPIC_*, LANGSMITH_*, AGENT_TIMEOUT_MS
  deps.ts                 # Dependency injection: db, redis, PostgresSaver checkpointer
  index.ts                # Public exports
  graph/
    annotation.ts         # AgentStateT — LangGraph state schema
    build-graph.ts        # Compiled StateGraph (singleton, cached)
    nodes/
      assemble-context.ts # Load subscriber, history, stage, flows from DB
      fast-path.ts        # Deterministic fast-path: affirm signal → ChangeStage(cascade), 0 LLM tokens
      stuck-breaker.ts    # Circuit breaker: N turns in same stage → HumanHandoff or disqualify
      understand.ts       # LLM call (wrapAnthropic) → LlmPlanSchema (Zod-validated)
      flow-engine.ts      # CALM declarative engine: evaluates transitions + emits commands
      execute-actions.ts  # Dispatches actions: sendFlow, sendContent, replyText, changeStage, notify
      respond.ts          # Assembles AgentResponse from final state
  core/
    llm/
      client.ts           # wrapAnthropic(new Anthropic()) — auto-traces to LangSmith
      prompt.ts           # System prompt assembly from tenant persona + state
      parse.ts            # Zod parse + LLM retry on validation failure
    flow-engine/
      engine.ts           # CALM engine: evaluates funnel_stages transition rules
      conditions.ts       # Condition evaluator for stage transition predicates
      stack.ts            # Command stack accumulator
      repair.ts           # Auto-repair for malformed LLM plans
    context/
      assemble.ts         # Context assembly: history, stage, available flows
      handoff.ts          # Human handoff context builder
      weighted.ts         # Weighted context selection for long transcripts
    memory/
      transcript.ts       # Transcript compaction (token budget aware)
  channel/
    types.ts              # ChannelAdapter interface
    manychat.ts           # ManyChat channel adapter
  services/
    traces.ts             # saveTurnTrace → api.agent_turn_traces + optional LangSmith
    dialogue-states.ts    # Persist/load agent state from api.dialogue_states
    context-queries.ts    # DB queries for context assembly
    flow-definitions.ts   # Load flows from api.funnel_stages + api.stage_flows
    handoff.ts            # Human escalation: interrupt() + Telegram notification
  actions/
    registry.ts           # Action handler registry
    handlers/
      change-stage.ts     # ChangeStage command handler
      reply-text.ts       # Text reply via ManyChat
      send-content.ts     # Media content via ManyChat
      notify-human.ts     # HumanHandoff: interrupt + Telegram
      schedule-followup.ts # Schedule followup via api.lead_crons
      http-request.ts     # Generic HTTP action
  scripts/
    seed-agent-config.ts  # Import flows + persona from seeds/ into DB
    export-conversation.ts # Export conversation bundle for LLM tuning
    (cutover.ts — archived, ran once for ADR-0024 Phase 4)

apps/dashboard/           # Next.js 15 analytics + self-service config panel
  /settings               # Tenant CRUD: funnel_stages, transitions, flows, persona, followups
  /                       # Lead kanban, conversation metrics

packages/
  db/src/schema.ts        # All Drizzle table definitions (pgSchema 'api')
  db/src/migrate.ts       # Migration runner (one-shot Docker service)
  db/src/seed.ts          # Tenant seeding
  db/drizzle/             # Migration SQL files (0001–current)
  shared/src/schemas/     # Zod schemas shared between API, agent, and n8n dispatch types

scripts/
  setup.sh                # Interactive first-time install: domains, secrets, Telegram, Calendly
  deploy.sh               # Redeploy stack (validates .env, docker stack deploy)
  backup.sh               # pg_dump + mc mirror → /var/backups/n8n/
  telegram-set-webhook.sh # Register Telegram callback webhook (run once)
  calendly-set-webhook.sh # Register Calendly invitee webhook (run once, paid plan required)
  init-minio-bucket.sh    # Create n8n-data + assets buckets

docs/
  DEPLOYMENT.md           # Full deployment guide for a new server
  adr/                    # Architecture Decision Records (ADR-0001 to ADR-0025)
  n8n/                    # n8n workflow specs (relevant for engine='n8n' tenants)
  api/                    # Route contracts and payload schemas
```

### Message flow

```
ManyChat → POST /webhook/manychat
  → auth (X-MC-Token) + idempotency (SHA-256 → Redis SET NX)
  → upsert subscriber + persist raw message (Postgres)
  → Lua atomic debounce (RPUSH buffer + reset debounce token + track first_msg_ts)
  → BullMQ job after DEBOUNCE_MS (default 15 s)

process-batch job fires:
  → token check (stale? skip) + max-wait override
  → acquire turn lock (Redis)
  → drain buffer (all buffered messages for this subscriber)
  → create turn record in Postgres

  if tenant.config.engine === 'agent':
    → dispatchToAgent() → runTurn(@dm-api/agent)
      → LangGraph graph.invoke()
          fast-path? → ChangeStage(cascade), 0 tokens, done
          stuck-breaker? → HumanHandoff, 0 tokens, done
          else:
            assemble-context → prepare_prompt → understand (LLM call)
            → flow-engine (CALM) → execute-actions → respond
      → saveTurnTrace(api.agent_turn_traces)  [always]
      → LangSmith trace                       [if LANGSMITH_TRACING=true]
    → release turn lock + persist metrics

  if tenant.config.engine === 'n8n':
    → dispatchToN8n() → POST panel.tudominio.com/webhook/agent-run
      (n8n workflow handles LLM + ManyChat response)
      n8n → POST /admin/turn-completed → releases lock + persists metrics
    → shadow: dispatchToAgent() in dry_run mode (isolated thread, no side effects)

Calendly → POST /webhook/calendly
  → identify subscriber by utm_content
  → persist booking (api.bookings) + cancel prospecting crons
  → inject ChangeStage(to='D', cascade, system_authorized) into debounce buffer
  → BullMQ job with delay=0 → agent executes stage advance + confirmation text

Telegram → POST /webhook/telegram
  → verify secret + parse callback_query
  → update lead status / resume / disqualify based on button action
```

## Critical rules

### Architecture boundary: Fastify/BullMQ vs. apps/agent

Almost everything is now TypeScript. n8n is **legacy only** (`engine='n8n'` tenants) and is not the active development path. The real boundary is:

| Fastify/BullMQ (`apps/api`) | apps/agent (LangGraph) |
|-----------------------------|------------------------|
| Auth, idempotency, rate-limit | Prompts, LLM selection, reasoning |
| Debounce Lua, turn lock | CALM flow engine, stage transitions |
| BullMQ queues + schedulers | ManyChat API calls (via channel adapter) |
| DB mutations: turns, bookings, lead_stages, crons | Memory: transcript compaction, dialogue_states |
| Telegram escalation routing | HumanHandoff decision (when to escalate) |
| Calendly webhook → inject system_event | Booking confirmation text |
| Followup runner, pause reminder | — |

**Do not add new logic to n8n workflows.** All new features go into `apps/api` (infrastructure/routing) or `apps/agent` (conversation/LLM logic).

n8n remains running for `engine='n8n'` legacy tenants and as the shadow dry-run receiver. No new tenants should be onboarded with `engine='n8n'`.

### `tenant.config.engine` controls dispatch

```typescript
const engine = tenantConfig.engine ?? 'n8n';   // 'agent' | 'n8n'
if (engine === 'agent') {
  await dispatchToAgent({ input: turnInput });   // LangGraph, synchronous
} else {
  await dispatchToN8n({ ... });                  // n8n webhook, async callback
  // shadow (dry-run) runs in parallel for evaluation
}
```

### Multi-tenancy
Every new table needs `tenant_id UUID NOT NULL`. Every Redis key uses a `{tenant_id}:` prefix (see `lib/redis-keys.ts`). Every query filters by tenant.

### Logging
Use `pino` via `lib/logger.ts`. Never `console.log`. Never log raw webhook bodies (PII risk).

### Idempotency
Webhooks: SHA-256 hash → Redis SET NX. BullMQ jobs: deterministic `jobId` where applicable.

### Env vars
All env vars declared in `.env.example` and validated by Zod in `apps/api/src/config.ts` (API/worker) and `apps/agent/src/config.ts` (agent). Never read `process.env.X` directly — use `getConfig()`.

### No `any`
`noExplicitAny` is a Biome error. TypeScript config has `strict: true` + `noUncheckedIndexedAccess: true`.

### New dependencies
Require an ADR in `docs/adr/` before adding packages outside the established stack (Fastify, BullMQ, Drizzle, LangGraph, Redis, Zod, pino, vitest).

## Agent internals (apps/agent)

### Graph nodes (in execution order)

```
assemble-context  Load subscriber, conversation history, current stage, available flows
fast-path         Deterministic: affirm signal + flow_only stage + single 'affirm' transition
                  → ChangeStage(cascade), 0 LLM tokens. Returns 'llm' on any ambiguity.
stuck-breaker     Circuit breaker: lead stuck N turns in same stage → HumanHandoff or deny transition.
                  Only fires when fast-path returned 'llm'. 0 LLM tokens.
understand        LLM call → LlmPlanSchema (Zod). Retry once with correction on parse failure.
flow-engine       CALM declarative engine: evaluates tenant stage_transitions_map + emits commands.
execute-actions   Dispatch each command: sendFlow, sendContent, replyText, changeStage, notify.
respond           Build AgentResponse from final state.
```

### Observability layers

1. **`api.agent_turn_traces`** (always): business-readable trace — reasoning, flow_path, response_texts, metrics, error. Never leaves infra, no PII shipped.
2. **LangSmith** (optional, `LANGSMITH_TRACING=true`): technical graph trace — node spans, LLM input/output, token counts, latency. Uses `wrapAnthropic()` for automatic span capture.

> LangSmith ≥ 0.2 reads only `LANGSMITH_*` vars. Old `LANGCHAIN_*` vars are silently ignored.

### Fast-path and stuck-breaker are cost controls

- **fast-path**: 0 tokens on the happy path (affirm signal + `flow_only` stage + unambiguous `trigger:'affirm'` transition)
- **stuck-breaker**: 0 tokens when a lead is looping (N turns without stage advance). Configured per-stage via `max_turns_in_stage` in tenant config. Default action: `HumanHandoff`.

### dry_run / shadow mode

When `input.dry_run === true`, the agent runs in an isolated LangGraph thread (`shadow:{conversation_id}:{turn_id}`) that does NOT write to the real checkpoint. Used for parallel evaluation of `engine='n8n'` tenants without side effects.

## Commit convention

Conventional Commits: `feat(api):`, `fix(agent):`, `refactor(worker):`, `docs(adr):`, `test(agent):`, `chore(deps):`.

CI runs lint + typecheck + build + test on every push (`.github/workflows/ci.yml`). Never commit without these passing locally.
