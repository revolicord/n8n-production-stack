# 04 — System Map
## Arquitectura Técnica Real (2026-05-19)

---

> **Propósito:** Foto técnica del sistema en operación. Para la frontera código vs n8n ver también el ADR-0010..0016 y `docs/_archive/docs-dm-settings/02-frontera-codigo-vs-n8n.md`.

---

## 1. Diagrama de Alto Nivel

```
                  ┌───────────────────────┐
                  │   Instagram (Meta)    │
                  └───────────┬───────────┘
                              │ DMs / comentarios / followers
                  ┌───────────▼───────────┐
                  │      ManyChat         │  ← Webhook → DM API; sendFlow/sendContent ← n8n
                  └───────────┬───────────┘
                              │ POST /webhook/manychat
                  ┌───────────▼───────────────────────────────┐
                  │  DM API (apps/api — Fastify + BullMQ)     │
                  │  Auth · Idempotency · Debounce · Lock     │
                  │  Persistencia raw · Dispatch a n8n        │
                  └─────────┬──────────────────────┬──────────┘
                            │ POST /webhook/agent-run
                  ┌─────────▼──────────────────────┴──────────┐
                  │  n8n  (workflow: agent-run)               │
                  │  Build Context → AI Agent (Claude 4.6) →  │
                  │  Tools: trigger_manychat_flow + set_stage │
                  │  → Memory: Postgres Chat Memory           │
                  │  → Callback al DM API (turn-completed)    │
                  └─────────┬──────────────────────────────────┘
                            │ HTTP a ManyChat sendFlow/sendContent
                            ▼
                       Instagram DM al lead

                  ┌────────────────────────────────────────┐
                  │  n8n  (workflow: followup-runner)      │
                  │  Schedule cada 5 min · lee lead_crons  │
                  │  Avanza secuencias / archiva           │
                  │  Pendiente: cablear en UI              │
                  └────────────────────────────────────────┘
```

---

## 2. Componentes

### 2.1 Instagram
- **Rol:** Canal de comunicación con el lead.
- **Owner:** Meta (no controlable directamente).
- **Restricciones:** Política de mensajería 24h, anti-spam, riesgo de ban.

### 2.2 ManyChat
- **Rol:** Capa de captura de triggers (DM, comentarios, followers) y envío de mensajes/flows.
- **Owner técnico:** founder (cuenta del tenant Quantum Creators).
- **Configuración relevante:** los flows que el agente puede disparar siguen el patrón `QC_{STAGE}_{MEDIA}_{DESC}_{VARIANT}` (ADR-0016).

### 2.3 DM API (`apps/api`)
- **Stack:** Fastify + BullMQ + Drizzle + Redis + Postgres.
- **Despliegue:** servicio `dm-api` en Docker Swarm (ver `docker-stack.yml`).
- **Endpoints públicos:**
  - `POST /webhook/manychat` — webhook entrante autenticado por `MC_WEBHOOK_TOKEN`.
  - `GET /tenants/:slug/tools` — devuelve catálogo de flows (Bearer `N8N_CALLBACK_TOKEN`).
  - `POST /tenants/:slug/tools/sync` — sincroniza ManyChat → `stage_flows`.
  - `POST /admin/turn-completed` — callback de n8n al finalizar un turno.
  - `POST /admin/leads/:subscriberId/stage` — cambia etapa del lead.
- **Responsabilidades:** auth, idempotency (SHA-256 + Redis SET NX), rate-limit, debounce (Lua), lock de turno, BullMQ, mutaciones de DB.

### 2.4 n8n
- **Workflows activos:**
  - `agent-run` — Webhook → Build Context → AI Agent (Claude Sonnet 4.6 + Postgres Chat Memory + 2 tools) → enviar texto → callback.
  - `followup-runner` — Schedule (5 min). Especificado pero **pendiente de cablear**.
- **Modelo LLM:** **Claude Sonnet 4.6** (Anthropic) — migrado en v4 desde llama-3.3-70b (Groq) por adherencia en tool-calling.
- **Memoria:** Postgres Chat Memory (`n8n_chat_histories`, `session_id = manychat_subscriber_id`).
- **Tools:** Code Tools con JSON Schema manual (ver `docs/n8n/nodes/02-ai-agent.md`).

### 2.5 Postgres (fuente de verdad del CRM)
- **Schema `api`:** `tenants`, `subscribers`, `messages_raw`, `conversations`, `turns`, `lead_stages`, `stage_transitions`, `dead_letter_queue`, `funnel_stages`, `stage_flows`, `followup_templates`, `lead_followup_log`, `lead_crons`.
- **Migrations:** Drizzle, en `packages/db/drizzle/` (0000 → 0004).
- **Hoy es la ÚNICA fuente de verdad del estado de leads.** Close CRM no está integrado en MVP.

### 2.6 Redis
- **Rol:** Cola BullMQ + buffer de debounce + idempotency tokens + lock de turno.
- **Patrón de keys:** todas con prefijo `{tenant_id}:` (ver `lib/redis-keys.ts`).

### 2.7 MinIO
- **Rol:** Almacenamiento binario para n8n (archivos, imágenes recibidas de IG).
- **Configuración crítica:** ver ADR-0003.

### 2.8 Calendly
- **Rol:** Agendado de la llamada por el lead.
- **Integración hoy:** link único en `tenant.config.calendly_url`. Sin webhook entrante — `D` se marca por confirmación verbal del lead.
- **Pendiente (P1):** webhook Calendly → endpoint Fastify dedicado → `set_stage("D", ...)`.

### 2.9 Close CRM
- **Rol previsto:** mirror de leads/etapas para que el equipo comercial trabaje sobre Close.
- **Estado hoy:** **NO integrado en MVP**. Se integrará en V1+ — Close se nutrirá de Postgres (nunca al revés).

---

## 3. Flujos de Datos Clave

### 3.1 Lead nuevo entra al sistema
```
IG → ManyChat → POST /webhook/manychat (DM API)
  → auth + idempotency → upsert subscriber → persist raw message
  → Lua atómico (RPUSH buffer + reset debounce + SET first_msg)
  → BullMQ encola process-batch con delay = DEBOUNCE_MS (15s)
  → Worker fira → acquire turn lock → drain buffer → POST n8n agent-run
      n8n: Build Context (carga stage config + CRM context + system prompt)
           → AI Agent (Claude 4.6) toma decisión + llama tools
              → trigger_manychat_flow → sendFlow a ManyChat → IG
              → set_stage → POST /admin/leads/:id/stage → Postgres
           → callback al DM API (turn-completed) → libera lock + persiste métricas
```

### 3.2 Follow-up programado
```
followup-runner (Schedule 5min)
  → SELECT lead_crons WHERE next_followup_at <= NOW()
  → para cada lead: HTTP a ManyChat (sendContent o sendFlow)
  → INSERT lead_followup_log + INSERT n8n_chat_histories (memoria)
  → UPDATE lead_crons (avanzar secuencia o archivar)
```

### 3.3 Lead reserva en Calendly (P1, pendiente)
```
Lead reserva en Calendly → webhook a endpoint Fastify dedicado
  → verifica firma → set_stage("D", "calendly_booking", evidence=event_id)
  → notifica al closer (canal pendiente)
```

---

## 4. Ownership Matrix

| Componente | Owner Técnico | Owner de Negocio |
|---|---|---|
| ManyChat | founder | Alex |
| n8n (workflows + nodos) | founder + Claude Code | founder |
| DM API + DB | founder + Claude Code | founder |
| Prompt del agente | founder (iteración rápida en Set node) | Alex (validación) |
| Assets multimedia (vídeos, audios, VSL) | — | Alex |
| Close CRM (futuro) | — | Alex |

---

## 5. Gaps y Preguntas Abiertas

- [ ] Confirmar hosting y costos por servicio (Groq → Anthropic, Postgres managed vs self-host, etc.)
- [ ] Documentar credenciales y accesos en un vault separado
- [ ] Confirmar si hay ambientes (dev/staging/prod) o solo producción — hoy parece solo prod
- [ ] Diseñar el endpoint del webhook Calendly + plan de migración a `D` por evento (P1)
- [ ] Diseñar el ADR del cambio a salida JSON estructurada del agente (cambio arquitectónico pendiente)
