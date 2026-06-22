# Análisis de Ficheros - Rama feat/agent-fase1-contratos

Clasificación de todos los archivos modificados en la rama actual.

---

## 🔴 CRÍTICO — Motor Core del Agente

El corazón del sistema. Cualquier cambio aquí afecta la ejecución de turnos.

### LangGraph Orchestration
- `apps/agent/src/graph/build-graph.ts` — Construcción del grafo LangGraph principal
- `apps/agent/src/graph/annotation.ts` — Tipos y estado del grafo
- `apps/agent/src/graph/nodes/assemble-context.ts` — Nodo: armar contexto de turno
- `apps/agent/src/graph/nodes/understand.ts` — Nodo: entender mensaje/intención
- `apps/agent/src/graph/nodes/flow-engine.ts` — Nodo: ejecutar flow declarativo
- `apps/agent/src/graph/nodes/respond.ts` — Nodo: generar respuesta del LLM
- `apps/agent/src/graph/nodes/execute-actions.ts` — Nodo: ejecutar acciones (reply, stage-change, etc)
- `apps/agent/src/graph/nodes/fast-path.ts` — Nodo: fast-path flow_only (sin LLM)
- `apps/agent/src/graph/nodes/stuck-breaker.ts` — Nodo: detectar stuck state + recovery

### Entry Points y Control de Flujo
- `apps/agent/src/run-turn.ts` — Orquestador principal: recibe turno, corre LangGraph
- `apps/agent/src/resume.ts` — Resume fallido de LangGraph (handoff, interrupt)
- `apps/agent/src/index.ts` — Exports públicos de la librería

### Flow Engine (Declarativo)
- `apps/agent/src/core/flow-engine/engine.ts` — Ejecutor de flows: condition branches, acciones
- `apps/agent/src/core/flow-engine/conditions.ts` — Evaluadores de condiciones booleanas
- `apps/agent/src/core/flow-engine/repair.ts` — Repair logic para flows dañados
- `apps/agent/src/core/flow-engine/stack.ts` — Stack de frames para recursión de flows

### LLM Integration
- `apps/agent/src/core/llm/client.ts` — Cliente Anthropic Claude (caching, tool-use)
- `apps/agent/src/core/llm/prompt.ts` — Construction del prompt (system + user + cache_control)
- `apps/agent/src/core/llm/parse.ts` — Parse de respuesta LLM (JSON, tool calls)

### Memory & Transcript
- `apps/agent/src/core/memory/transcript.ts` — Compactación de transcript por token budget

### Actions (Estado)
- `apps/agent/src/actions/events.ts` — Event payload types
- `apps/agent/src/actions/handlers/reply-text.ts` — Acción: enviar texto a ManyChat
- `apps/agent/src/actions/handlers/send-content.ts` — Acción: enviar contenido/multimedia
- `apps/agent/src/actions/handlers/change-stage.ts` — Acción: cambiar stage del lead
- `apps/agent/src/actions/handlers/schedule-followup.ts` — Acción: agendar followup
- `apps/agent/src/actions/handlers/notify-human.ts` — Acción: notificar humano (escalación)
- `apps/agent/src/actions/handlers/http-request.ts` — Acción: HTTP genérico
- `apps/agent/src/actions/registry.ts` — Registro de handlers disponibles

### Channel Integration
- `apps/agent/src/channel/manychat.ts` — Adaptador ManyChat (parse, format respuestas)
- `apps/agent/src/channel/types.ts` — Tipos de canal
- `apps/agent/src/channel/manychat.test.ts` — Tests del adaptador

### Context & Utilities
- `apps/agent/src/core/context/assemble.ts` — Armar contexto: lead data + conversation + stage rules
- `apps/agent/src/core/context/handoff.ts` — Lógica handoff: escalación a humano
- `apps/agent/src/core/context/weighted.ts` — Weighted media ranking (escalación determinista)
- `apps/agent/src/services/context-queries.ts` — Queries SQL para contexto
- `apps/agent/src/services/dialogue-states.ts` — Query/insert de estados de diálogo
- `apps/agent/src/services/flow-definitions.ts` — Fetch flows por tenant
- `apps/agent/src/services/traces.ts` — Persist + query de execution traces
- `apps/agent/src/config.ts` — Env config validada

### API - Dispatch & Resume
- `apps/api/src/services/dispatch-agent.ts` — HTTP POST al agente (RPC)
- `apps/api/src/services/resume-agent.ts` — HTTP POST para resume post-interrupt
- `apps/api/src/routes/admin/agent-metrics.ts` — Metrics sobre turnos del agente

### Schemas Compartidos (Diálogo)
- `packages/shared/src/schemas/dialogue/flow.ts` — Schema Zod de flows declarativos
- `packages/shared/src/schemas/dialogue/commands.ts` — Comandos que puede generar el LLM
- `packages/shared/src/schemas/dialogue/turn.ts` — Input/output de un turno
- `packages/shared/src/schemas/dialogue/state.ts` — Estado de diálogo persistente
- `packages/shared/src/schemas/dialogue/index.ts` — Exports

---

## 🏗️ INFRAESTRUCTURA — Deployment, Config, DB

### Docker & Orchestration
- `docker-stack.yml` — Stack Docker Swarm completo
- `apps/api/Dockerfile` — Imagen dm-api para el contenedor

### Configuración
- `.env.example` — Template de env vars (debe sincronizarse con .env en cada env)
- `.gitignore` — Archivos ignorados por git

### Dependencias
- `pnpm-lock.yaml` — Lock file de pnpm workspaces
- `package.json` — Root workspace config
- `apps/agent/package.json` — Deps del agente (LangGraph, @anthropic-ai/sdk, etc)
- `apps/api/package.json` — Deps de la API
- `apps/dashboard/package.json` — Deps del dashboard
- `packages/db/package.json` — Deps de Drizzle
- `packages/shared/package.json` — Deps compartidos

### Configuración TypeScript
- `apps/agent/tsconfig.json` — TypeScript config (strict: true)
- `apps/agent/vitest.config.ts` — Test runner config
- Base tsconfig inherited from root (tsconfig.json no listado en diff, está en master)

### Migraciones de Base de Datos (Drizzle)
- `packages/db/drizzle/0015_adr0024_dialogue_tables.sql` — Tablas de diálogo (dialogue_turns, dialogue_states, etc)
- `packages/db/drizzle/0016_agent_turn_traces.sql` — Tabla agent_turn_traces para observabilidad
- `packages/db/drizzle/0017_funnel_is_terminal.sql` — Columna is_terminal en funnel_stages
- `packages/db/drizzle/0018_followups_bookings.sql` — Tablas bookings + reminders (migraron de n8n cron)
- `packages/db/drizzle/0019_agent_decision_path.sql` — Tabla decision_path (auditoría de flujos)
- `packages/db/drizzle/0020_stage_transition_trigger.sql` — Columna trigger en stage_transitions_map
- `packages/db/drizzle/meta/_journal.json` — Journal de migraciones aplicadas

### Schema Drizzle
- `packages/db/src/schema.ts` — Definición de todas las tablas (pgSchema 'api')

### Makefile
- `Makefile` — Comandos: deploy, logs, scale, migrate, seed-tenant, etc

---

## 📡 API — Rutas, Webhooks, Servicios

### Rutas (HTTP Endpoints)
- `apps/api/src/routes/index.ts` — Router root
- `apps/api/src/routes/webhook-manychat.ts` — POST /webhook/manychat (inbound mensajes)
- `apps/api/src/routes/webhook-calendly.ts` — POST /webhook/calendly (bookings)
- `apps/api/src/routes/webhook-telegram.ts` — POST /webhook/telegram (inbound Telegram)
- `apps/api/src/routes/tools.ts` — GET /tools (flows + tools para Build Context n8n)

### Admin Routes
- `apps/api/src/routes/admin/agent-metrics.ts` — Métricas de agente
- `apps/api/src/routes/admin/set-stage.ts` — POST /admin/set-stage (cambiar stage)
- `apps/api/src/routes/admin/stage-transitions-map.ts` — GET/POST transiciones por stage
- `apps/api/src/routes/admin/flow-definitions.ts` — GET/POST flows
- `apps/api/src/routes/admin/followups.ts` — GET/POST followups programados
- `apps/api/src/routes/admin/booking-reminders.ts` — GET/POST reminders de booking
- `apps/api/src/routes/admin/notifications.ts` — GET/POST notificaciones
- `apps/api/src/routes/admin/pause.ts` — POST /admin/pause (pausar tenant)
- `apps/api/src/routes/admin/tenants.ts` — GET/POST tenants

### Servicios (Business Logic)
- `apps/api/src/services/dispatch-agent.ts` — HTTP RPC al agente
- `apps/api/src/services/resume-agent.ts` — Resume post-interrupt
- `apps/api/src/services/debounce.ts` — Lua script: debounce de mensajes
- `apps/api/src/services/flow-definitions.ts` — Query flows de BD
- `apps/api/src/services/stage-transitions-map.ts` — Query transiciones
- `apps/api/src/services/tenants.ts` — Query/insert tenants
- `apps/api/src/services/followups.ts` — CRUD de followups
- `apps/api/src/services/followup-render.ts` — Renderizar template de followup
- `apps/api/src/services/bookings.ts` — CRUD de bookings
- `apps/api/src/services/notifications.ts` — CRUD de notificaciones
- `apps/api/src/services/lead-crons.ts` — Ejecutar jobs cron (deprecated, migrado a BullMQ)
- `apps/api/src/services/manychat-sync.ts` — Sync flows ManyChat
- `apps/api/src/services/agent-metrics.ts` — Calcular y persistir métricas

### Workers (BullMQ)
- `apps/api/src/worker.ts` — Entrada del worker BullMQ
- `apps/api/src/workers/process-batch.ts` — Job: procesar batch de mensajes debounceados
- `apps/api/src/workers/followup-runner.ts` — Job: ejecutar followups programados
- `apps/api/src/workers/notify.ts` — Job: enviar notificaciones (email, SMS, etc)

### Libs
- `apps/api/src/lib/queue.ts` — Instancia BullMQ compartida
- `apps/api/src/lib/telegram.test.ts` — Test de Telegram

### Config & Tests
- `apps/api/src/config.ts` — Zod validation de env vars
- `apps/api/src/routes/webhook-manychat.test.ts` — Tests de webhook ManyChat

---

## 💻 DASHBOARD — Frontend Next.js 15

### Páginas de Settings
- `apps/dashboard/src/app/(dashboard)/settings/agente/page.tsx` — Panel: config del agente (prompt, modelos)
- `apps/dashboard/src/app/(dashboard)/settings/flows/page.tsx` — Panel: definir/editar flows declarativos
- `apps/dashboard/src/app/(dashboard)/settings/funnel/page.tsx` — Panel: definir etapas del funnel
- `apps/dashboard/src/app/(dashboard)/settings/transiciones/page.tsx` — Panel: transiciones entre etapas
- `apps/dashboard/src/app/(dashboard)/settings/cascadas/page.tsx` — Panel: cascadas (contenido por etapa)
- `apps/dashboard/src/app/(dashboard)/settings/follow-ups/page.tsx` — Panel: followups programados
- `apps/dashboard/src/app/(dashboard)/settings/booking-reminders/page.tsx` — Panel: reminders de citas
- `apps/dashboard/src/app/(dashboard)/settings/notificaciones/page.tsx` — Panel: notificaciones
- `apps/dashboard/src/app/(dashboard)/escalaciones/page.tsx` — Panel: ver escalaciones (handoffs)

### Server Actions (API del dashboard)
- `apps/dashboard/src/app/(dashboard)/settings/_actions/agente.ts` — upsert agent config
- `apps/dashboard/src/app/(dashboard)/settings/_actions/flows.ts` — upsert flows
- `apps/dashboard/src/app/(dashboard)/settings/_actions/funnel.ts` — upsert stages
- `apps/dashboard/src/app/(dashboard)/settings/_actions/transitions.ts` — upsert transiciones
- `apps/dashboard/src/app/(dashboard)/settings/_actions/cascades.ts` — upsert cascadas
- `apps/dashboard/src/app/(dashboard)/settings/_actions/follow-ups.ts` — upsert followups
- `apps/dashboard/src/app/(dashboard)/settings/_actions/booking-reminders.ts` — upsert reminders
- `apps/dashboard/src/app/(dashboard)/settings/_actions/notifications.ts` — upsert notificaciones

### Componentes
- `apps/dashboard/src/components/settings/SettingsTabs.tsx` — Tabs principal (nav entre paneles)
- `apps/dashboard/src/components/settings/AgenteEditor.tsx` — Form: editar config agente
- `apps/dashboard/src/components/settings/FlowsEditor.tsx` — Form: editar flows
- `apps/dashboard/src/components/settings/FunnelEditor.tsx` — Form: editar funnel
- `apps/dashboard/src/components/settings/TransitionsEditor.tsx` — Form: editar transiciones
- `apps/dashboard/src/components/settings/CascadesEditor.tsx` — Form: editar cascadas
- `apps/dashboard/src/components/settings/FollowupsEditor.tsx` — Form: editar followups
- `apps/dashboard/src/components/settings/BookingRemindersEditor.tsx` — Form: editar reminders
- `apps/dashboard/src/components/settings/NotificationsEditor.tsx` — Form: editar notificaciones
- `apps/dashboard/src/components/shell/AutoRefresh.tsx` — Refrescar automático de datos

### Libs & Utils
- `apps/dashboard/src/lib/flow-definitions.ts` — Fetch flows desde API
- `apps/dashboard/src/lib/stage-transitions.ts` — Fetch transiciones desde API

### Config
- `apps/dashboard/package.json` — Dependencias

---

## ✅ TESTS — Cobertura del Motor

- `apps/agent/src/__tests__/engine.test.ts` — Tests flow-engine (conditions, branches)
- `apps/agent/src/__tests__/flow-only-policy.test.ts` — Tests fast-path sin LLM
- `apps/agent/src/__tests__/no-reply-guardrail.test.ts` — Tests guardrail "nunca dejar sin texto"
- `apps/agent/src/__tests__/stuck-breaker.test.ts` — Tests detección stuck + recovery
- `apps/agent/src/__tests__/transcript-compaction.test.ts` — Tests compactación de transcript
- `apps/agent/src/__tests__/handoff.test.ts` — Tests lógica escalación
- `apps/agent/src/__tests__/weighted.test.ts` — Tests weighted media ranking
- `apps/agent/src/__tests__/interrupt-pattern.test.ts` — Tests pattern de interrupt en LangGraph
- `apps/agent/src/__tests__/traces.test.ts` — Tests persistencia de traces
- `apps/agent/src/__tests__/conditions.test.ts` — Tests evaluadores de condiciones
- `apps/agent/src/__tests__/fast-path.test.ts` — Tests fast-path
- `apps/agent/src/actions/handlers/reply-text.test.ts` — Tests envío de texto
- `apps/agent/src/actions/handlers/send-content.test.ts` — Tests envío de contenido
- `apps/api/src/routes/webhook-manychat.test.ts` — Tests webhook ManyChat
- `apps/api/src/services/followup-render.test.ts` — Tests render de templates
- `apps/api/src/services/notifications.test.ts` — Tests notificaciones
- `apps/api/src/workers/notify.test.ts` — Tests worker notificaciones
- `apps/dashboard/src/components/settings/...test.ts` — Tests de componentes (si hay)
- `packages/shared/src/schemas/dialogue/__tests__/flows-qc.test.ts` — Tests flows QC
- `packages/shared/src/schemas/dialogue/__tests__/flows-bufete.test.ts` — Tests flows bufete

---

## 📚 DOCUMENTACIÓN — ADRs, Guías, Specs

### Architecture Decision Records (ADRs)
- `docs/adr/0009-workflow-agent-run-configuracion.md` — ADR-0009: n8n agent-run + configuración
- `docs/adr/0017-turn-timeout-watchdog.md` — ADR-0017: watchdog de timeouts
- `docs/adr/0023-handoff-state-y-taxonomia-de-medios.md` — ADR-0023: handoff + media taxonomy
- `docs/adr/0024-fable-implementation-prompt.md` — ADR-0024: Fable implementation sketch
- `docs/adr/0024-motor-dialogo-declarativo-agnostico.md` — ADR-0024: Motor declarativo (flow-engine)
- `docs/adr/0025-langgraph-orquestacion-y-observabilidad.md` — ADR-0025: LangGraph + traces
- `docs/adr/Plan Panel de configuracion de negocio multi tenant sin codigo.md` — Plan: panel self-service
- `docs/adr/plan de implenetacion de adr-0024.md` — Plan: implementación ADR-0024

### Guías de Agent Tuning
- `docs/agent-tuning/README.md` — Índice de tuning
- `docs/agent-tuning/expert-system-prompt.md` — Sistema de prompt para expertos
- `docs/business-rules-qc.md` — Reglas de negocio: registros de tono, policies

### Observabilidad & Memory
- `docs/langsmith-langgraph-observabilidad.md` — LangSmith setup para LangGraph
- `docs/handoff-memory-context-implementation.md` — Implementación handoff + memory
- `docs/15_TOKEN_OPTIMIZATION_AND_FAST_PATH.md` — Optimización de tokens + fast-path

### n8n Workflows (Legacy Reference)
- `docs/n8n/README.md` — Índice de workflows + node map
- `docs/n8n/nodes/00c-system-prompt.md` — Node: system prompt (legacy)
- `docs/n8n/nodes/00g-combine-contexts.md` — Node: combine contexts (legacy)
- `docs/n8n/nodes/00h-get-handoff-state.md` — Node: get handoff state (legacy)
- `docs/n8n/nodes/01-build-context.md` — Node: build context (legacy)
- `docs/n8n/panel-flows-workflow.json` — Workflow n8n legacy del panel
- `docs/n8n/prompts/setter-v1.md` — Prompt setter v1 (legacy)

---

## 🔧 SCRIPTS & UTILIDADES

### Agent Scripts
- `apps/agent/scripts/cutover.ts` — Script: cutover migration (agent old → new)
- `apps/agent/scripts/replay.ts` — Script: replay conversation (debug)
- `apps/agent/scripts/prune-traces.ts` — Script: limpiar traces antiguos
- `apps/agent/scripts/parity-report.sql` — SQL: reportar parity entre sistemas

### API Scripts
- `apps/api/src/scripts/smoke-manychat.ts` — Script: smoke test ManyChat (verificar flujo)
- `scripts/reset-db.sh` — Script: borrar todos los datos (subscribers, turns, etc)
- `scripts/sql/qc-fase2-eliminar-ms-y-anti-anzuelo.sql` — SQL: migración QC Fase 2

### Agent Scripts (Seed & Export)
- `apps/agent/src/scripts/export-conversation.ts` — Script: exportar conversación para feedback
- `apps/agent/src/scripts/seed-agent-config.ts` — Script: cargar config de agente por tenant

---

## 🌱 SEEDS & DEFAULTS — Datos Iniciales

### Configuración de Tenants
- `packages/db/src/seeds/config-qc.json` — Configuración tenant QC (flows, stages, cascadas)
- `packages/db/src/seeds/flows-qc.json` — Flows declarativos para QC
- `packages/db/src/seeds/flows-bufete.json` — Flows declarativos para bufete (tenant sintético)
- `packages/db/src/seeds/persona-qc.md` — Persona/guidelines QC

### Defaults
- `packages/shared/src/defaults/platform-skeleton.ts` — Estructura base de tenant

---

## 📋 SCHEMAS COMPARTIDOS — Tipos Zod

### Core Types
- `packages/shared/src/schemas/manychat.ts` — Tipos de webhooks ManyChat
- `packages/shared/src/schemas/n8n-dispatch.ts` — Tipos payload n8n (legacy reference)
- `packages/shared/src/schemas/tenant-config.ts` — Validación config tenant

### Dialogue (Novo)
- `packages/shared/src/schemas/dialogue/flow.ts` — Schema flow declarativo
- `packages/shared/src/schemas/dialogue/commands.ts` — Comandos LLM (reply, stage, etc)
- `packages/shared/src/schemas/dialogue/turn.ts` — Input/output turno
- `packages/shared/src/schemas/dialogue/state.ts` — Estado persistente
- `packages/shared/src/schemas/dialogue/index.ts` — Exports

### Shared Index
- `packages/shared/src/index.ts` — Root exports

---

## 📊 RESUMEN DE CAMBIOS

| Categoría | Num. Archivos | Impacto |
|-----------|---------------|--------|
| **Crítico** | 35+ | Alto — motor core |
| **Infraestructura** | 12+ | Medio-Alto — deploy/config |
| **API** | 30+ | Alto — rutas/servicios |
| **Dashboard** | 17+ | Medio — UI self-service |
| **Tests** | 21+ | Medio — cobertura |
| **Documentación** | 13+ | Bajo-Medio — reference |
| **Scripts & Seeds** | 10+ | Bajo — tooling/data |
| **Schemas** | 8+ | Medio — tipos |
| **TOTAL** | ~146 archivos | 🎯 **Fase 1: Agente + Contratos** |

---

## 🎯 Puntos de Atención (Críticos)

1. **Migraciones DB** (0015-0020): Deben ejecutarse en orden sin saltar
2. **apps/agent**: Nueva librería de orquestación — entrada: `run-turn.ts`
3. **dispatch-agent.ts + resume-agent.ts**: Glue code entre API y agente
4. **dashboard settings**: Formularios auto-generan config de tenant
5. **Flow Engine**: Reemplaza n8n para lógica declarativa en hot-path

---

## 🚀 Orden Recomendado de Deploy

1. Migraciones DB (0015-0020)
2. `make rebuild-api` (recompila apps/agent + apps/api)
3. `make rebuild-dashboard`
4. Seed tenants: `make seed-agent-config SLUG=revolicord N8N_WORKFLOW_URL=...`
5. Smoke test: `pnpm smoke:manychat`
