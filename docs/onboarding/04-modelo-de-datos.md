# 04 · Modelo de datos

**Postgres es la fuente de verdad. Redis es estado caliente y efímero.**

La API vive en el schema `api`; n8n tiene su propio schema (`n8n`) en la misma base. No se cruzan. La definición canónica de las tablas está en [`packages/db/src/schema.ts`](../../packages/db/src/schema.ts) (Drizzle); las migraciones en `packages/db/drizzle/`.

> Convenciones: UUID como PK (`gen_random_uuid()`), timestamps `timestamptz` con default `now()`, casi toda tabla lleva `tenant_id`, y toda query filtra por tenant en código.

## Tablas — núcleo de mensajería

```sql
-- Tenants (clientes de la agencia)
CREATE TABLE api.tenants (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                        TEXT NOT NULL UNIQUE,
  name                        TEXT NOT NULL,
  manychat_account_id         TEXT,
  manychat_api_key_encrypted  TEXT,
  is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
  config                      JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- config: { debounce_ms, max_wait_ms, n8n_workflow_url, system_prompt, calendly_url, ... }
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Suscriptores (un usuario de Instagram, identificado por ManyChat)
CREATE TABLE api.subscribers (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES api.tenants(id) ON DELETE CASCADE,
  manychat_subscriber_id  TEXT NOT NULL,
  ig_user_id              TEXT,
  ig_username             TEXT,
  display_name            TEXT,
  locale                  TEXT,
  current_channel         TEXT,           -- último canal por el que escribió
  opt_ins                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  status                  TEXT NOT NULL DEFAULT 'active',  -- active | paused | blocked
  paused_until            TIMESTAMPTZ,
  metadata                JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, manychat_subscriber_id)
);

-- Mensajes raw (auditoría completa, fuente de verdad del audit)
CREATE TABLE api.messages_raw (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  subscriber_id       UUID NOT NULL,
  channel             TEXT NOT NULL DEFAULT 'instagram',
  external_message_id TEXT,
  idempotency_hash    TEXT NOT NULL,
  direction           TEXT NOT NULL,      -- 'in' | 'out'
  payload             JSONB NOT NULL,
  text                TEXT,
  has_media           BOOLEAN NOT NULL DEFAULT FALSE,
  media_urls          TEXT[],
  trigger_source      TEXT,               -- default_reply | story_reply | comment_reply | ...
  trigger_channel     TEXT,               -- instagram_dm | instagram_story | ...
  trigger_ref         TEXT,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_hash)    -- red de seguridad final de idempotencia
);

-- Conversaciones (sesiones lógicas)
CREATE TABLE api.conversations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  subscriber_id    UUID NOT NULL,
  opened_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at        TIMESTAMPTZ,
  last_user_msg_at TIMESTAMPTZ,
  last_bot_msg_at  TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'open',  -- open | closed | escalated
  summary          TEXT,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Turns: cada batch enviado al agente en n8n
CREATE TABLE api.turns (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  conversation_id   UUID NOT NULL REFERENCES api.conversations(id),
  subscriber_id     UUID NOT NULL,
  batch_size        INT  NOT NULL,
  batch_text        TEXT NOT NULL,
  batch_message_ids UUID[] NOT NULL,
  llm_model         TEXT,
  prompt_version    TEXT,
  input_tokens      INT,
  output_tokens     INT,
  cost_usd          NUMERIC(10, 6),
  response_text     TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
                    -- pending | dispatched | completed | failed | cancelled
  n8n_execution_id  TEXT,
  error             TEXT,
  retry_count       INT NOT NULL DEFAULT 0,
  trigger_source    TEXT,
  trigger_channel   TEXT,
  parent_turn_id    UUID,                 -- para retries
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  dispatched_at     TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  duration_ms       INT
);

-- Dead Letter Queue (fallos persistentes tras agotar reintentos)
CREATE TABLE api.dead_letter_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  source          TEXT NOT NULL,          -- 'webhook' | 'n8n_dispatch' | 'manychat_send'
  payload         JSONB NOT NULL,
  error           TEXT NOT NULL,
  retry_count     INT NOT NULL,
  related_turn_id UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ,
  resolved_by     TEXT
);
```

## Tablas — funnel y follow-ups

Estas tablas implementan el funnel data-driven (ADR-0010) y el sistema de follow-ups por etapa (ADR-0011, 0015). El detalle de cómo se usan está en los docs [07-funnel-y-agente](07-funnel-y-agente.md) y [08-follow-ups-y-crons](08-follow-ups-y-crons.md).

```sql
-- Etapas del funnel, configurables por tenant (ADR-0010)
CREATE TABLE api.funnel_stages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  slug          TEXT NOT NULL,            -- 'A' | 'MS' | 'B' | 'C' | 'D' | ... (por tenant)
  display_name  TEXT NOT NULL,
  position      INT  NOT NULL,
  description   TEXT,
  max_followups INT  DEFAULT 3,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

-- Variantes A/B de flows de ManyChat por etapa (ADR-0010, 0016)
CREATE TABLE api.stage_flows (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id    UUID NOT NULL REFERENCES api.funnel_stages(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL,
  flow_ns     TEXT NOT NULL,             -- ns real de ManyChat: content20260511...
  description TEXT,
  weight      INT     DEFAULT 1,         -- peso para selección A/B ponderada
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  -- Columnas añadidas en migración 0003 (ver nota de desfase al final):
  human_name          TEXT,             -- nombre legible: QC_A_video_hook_v1
  media_type          TEXT,             -- video | audio | img | txt | sticker
  content_description TEXT,             -- qué ve/escucha el lead
  usage_condition     TEXT,             -- cuándo debe usarlo el agente
  variant_group       TEXT,             -- agrupa variantes A/B
  pending_ns          TEXT,             -- ns recibido del sync, pendiente de aprobación
  synced_at           TIMESTAMPTZ
);

-- Etapa actual del lead (ADR-0014 Path B)
CREATE TABLE api.lead_stages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES api.tenants(id) ON DELETE CASCADE,
  subscriber_id    UUID NOT NULL REFERENCES api.subscribers(id) ON DELETE CASCADE,
  current_stage    TEXT NOT NULL DEFAULT 'nuevo',
  current_stage_id UUID REFERENCES api.funnel_stages(id),   -- FK añadida en ADR-0014
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, subscriber_id)
);

-- Log inmutable de cambios de etapa
CREATE TABLE api.stage_transitions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  subscriber_id  UUID NOT NULL,
  turn_id        UUID REFERENCES api.turns(id),
  from_stage     TEXT NOT NULL,
  to_stage       TEXT NOT NULL,
  reason         TEXT,
  agent_evidence TEXT,                   -- la frase del usuario que justifica el cambio
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Plantillas de follow-up por etapa (ADR-0015)
CREATE TABLE api.followup_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id        UUID NOT NULL REFERENCES api.funnel_stages(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL,
  sequence_number INT  NOT NULL,
  delay_hours     INT  NOT NULL,
  type            TEXT NOT NULL,         -- 'text' | 'flow'
  text_template   TEXT,
  flow_ns         TEXT,
  description     TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (stage_id, sequence_number)
);

-- Registro inmutable de follow-ups enviados (ADR-0015)
CREATE TABLE api.lead_followup_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  subscriber_id   UUID NOT NULL,
  conversation_id UUID NOT NULL,
  stage_id        UUID REFERENCES api.funnel_stages(id),
  template_id     UUID REFERENCES api.followup_templates(id),
  sequence_number INT  NOT NULL,
  text_sent       TEXT,
  sent_at         TIMESTAMPTZ DEFAULT now(),
  status          TEXT DEFAULT 'sent',   -- sent | failed | responded | skipped
  responded_at    TIMESTAMPTZ
);

-- Detector de inactividad y programador de follow-ups (ADR-0011)
CREATE TABLE api.lead_crons (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL,
  subscriber_id        UUID NOT NULL,
  conversation_id      UUID NOT NULL,
  current_stage_id     UUID REFERENCES api.funnel_stages(id),
  next_followup_at     TIMESTAMPTZ,
  next_sequence_number INT     DEFAULT 1,
  is_active            BOOLEAN DEFAULT TRUE,
  archived_at          TIMESTAMPTZ,
  archive_reason       TEXT,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, subscriber_id, conversation_id)
);
```

### Relaciones

```
tenants
  ├── subscribers ──┬── lead_stages (current_stage_id → funnel_stages)
  │                 ├── lead_crons  (current_stage_id → funnel_stages)
  │                 ├── conversations ── turns ── stage_transitions
  │                 └── messages_raw
  └── funnel_stages ─┬── stage_flows
                     └── followup_templates ── lead_followup_log
```

> **No existen** (todavía) las tablas `closers`, `notifications`, `objection_bank` ni `audit_log`/`processed_webhooks`. Aparecen en diseños previos (docs 07/13 y el motor de funnel) pero forman parte de lo que **falta** — ver [`status.md`](../status.md).

## Memoria conversacional del agente

La memoria del agente **no vive en Redis**. n8n usa el nodo **Postgres Chat Memory**, que persiste el historial en la tabla `n8n_chat_histories` (schema `n8n`), con `session_id = manychat_subscriber_id`. Tanto `agent-run` (turnos del agente) como `followup-runner` (follow-ups automáticos, marcados `[SEGUIMIENTO AUTOMÁTICO #N]`) escriben ahí. Ver ADR-0012 y [08-follow-ups-y-crons](08-follow-ups-y-crons.md).

## Redis: claves y TTLs

Estado caliente del debounce y la cola. Definición canónica en [`apps/api/src/lib/redis-keys.ts`](../../apps/api/src/lib/redis-keys.ts).

| Clave | Tipo | TTL | Propósito |
|---|---|---|---|
| `idemp:{hash}` | STRING `1` | 24 h | Dedup de webhooks (SET NX) |
| `buffer:{tenant}:{subscriber}` | LIST de JSON | defensivo | Mensajes acumulados de la ráfaga |
| `debounce:{tenant}:{subscriber}` | STRING `<token-uuid>` | = ventana | Token único; se sobreescribe con cada mensaje |
| `firstmsg:{tenant}:{subscriber}` | STRING (ts ms) | = max_wait | Fuerza dispatch si se excede `max_wait` |
| `lock:turn:{tenant}:{subscriber}` | STRING `<turn_id>` | = lock TTL | Lock del turno mientras n8n procesa |
| `rate:{tenant}:{subscriber}` | (rate limit) | 60 s | Límite por suscriptor |
| `bull:*` | varias | n/a | BullMQ (jobs delayed, completed, failed) |

> Las claves usan `{tenant}:{subscriber}` (sin sufijo de canal). Los valores por defecto de las ventanas (`DEBOUNCE_MS=15000`, `MAX_WAIT_MS=30000`, `LOCK_TTL_MS=90000`) viven en `apps/api/src/config.ts` y son configurables por tenant. Ver [03-debounce-y-turnos](03-debounce-y-turnos.md).

### Estructura de un mensaje en el buffer

```json
{ "id": "uuid de messages_raw", "text": "hola", "ts": 1730000000000, "media_urls": [] }
```

## Ciclo de vida de los datos

```
mensaje entrante
   ↓
messages_raw (insert, antes del ACK)
   ↓
buffer Redis (RPUSH) → debounce → drenaje
   ↓
turn (insert pending) → n8n dispatch → turn (update completed + coste)
   ↓
conversations.last_bot_msg_at + n8n_chat_histories (memoria del agente)
   ↓
lead_stages / stage_transitions (si el agente cambia de etapa)
   ↓
lead_crons (programa el próximo follow-up)
```

## Backups

- **Postgres**: `pg_dump` diario (schemas `n8n` + `api`). Ver [11-deploy-docker-swarm](11-deploy-docker-swarm.md) y `scripts/backup.sh`.
- **Redis**: snapshot diario. **Redis no es fuente de verdad**: si se pierde, los buffers se vacían y los mensajes en vuelo se pierden. Por eso se persiste `messages_raw` en Postgres **antes** de hacer ACK al webhook.

## Nota de desfase (schema.ts vs. BD)

La migración `0003_flow_registry.sql` añadió a `stage_flows` las columnas `human_name`, `media_type`, `content_description`, `usage_condition`, `variant_group`, `pending_ns` y `synced_at` mediante SQL directo. `packages/db/src/schema.ts` **aún no las declara**. La BD de producción es correcta; el schema de Drizzle está desfasado y debería regenerarse. Detalle en [`status.md`](../status.md).
