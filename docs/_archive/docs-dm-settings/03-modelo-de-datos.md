# 03 · Modelo de datos

Postgres es la fuente de verdad. Redis es estado caliente y efímero.

## Postgres: schema `api`

n8n tiene su propio schema (`n8n`) en la misma base. La API tiene `api`. No se cruzan.

### Convenciones

- IDs externos (UUID v7 si es posible para sortabilidad temporal, fallback v4).
- Timestamps siempre `timestamptz` con default `now()`.
- Soft delete con `deleted_at timestamptz` solo donde aplique.
- Todas las tablas con `tenant_id` excepto `tenants` y `audit_log` global.
- Row Level Security (RLS) activado por `tenant_id`.

### Tablas

```sql
-- Tenants (clientes de la agencia)
CREATE TABLE api.tenants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  manychat_account_id TEXT,
  manychat_api_key_encrypted TEXT,  -- cifrado at rest
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- config ejemplo:
  -- { "debounce_ms": 8000, "max_wait_ms": 30000,
  --   "rate_per_minute": 20, "n8n_workflow_url": "...", "model": "gpt-4o-mini" }
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
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
  opt_ins                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  status                  TEXT NOT NULL DEFAULT 'active',  -- active | paused | blocked
  paused_until            TIMESTAMPTZ,
  metadata                JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, manychat_subscriber_id)
);
CREATE INDEX ON api.subscribers (tenant_id, status);
CREATE INDEX ON api.subscribers (tenant_id, last_seen_at DESC);

-- Mensajes raw (auditoría completa, fuente de verdad)
CREATE TABLE api.messages_raw (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  subscriber_id       UUID NOT NULL,
  channel             TEXT NOT NULL DEFAULT 'instagram',
  external_message_id TEXT,
  idempotency_hash    TEXT NOT NULL,
  direction           TEXT NOT NULL,  -- 'in' | 'out'
  payload             JSONB NOT NULL,
  text                TEXT,
  has_media           BOOLEAN NOT NULL DEFAULT FALSE,
  media_urls          TEXT[],
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_hash)
);
CREATE INDEX ON api.messages_raw (tenant_id, subscriber_id, received_at DESC);
-- Particionar por mes cuando supere 50M filas:
-- ALTER TABLE api.messages_raw PARTITION BY RANGE (received_at);

-- Conversaciones (sesiones lógicas)
CREATE TABLE api.conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  subscriber_id   UUID NOT NULL,
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at       TIMESTAMPTZ,
  last_user_msg_at TIMESTAMPTZ,
  last_bot_msg_at TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'open',  -- open | closed | escalated
  summary         TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX ON api.conversations (tenant_id, subscriber_id, status);
CREATE INDEX ON api.conversations (tenant_id, last_user_msg_at DESC);

-- Turns: cada batch enviado al LLM
CREATE TABLE api.turns (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  conversation_id     UUID NOT NULL REFERENCES api.conversations(id),
  subscriber_id       UUID NOT NULL,
  batch_size          INT NOT NULL,
  batch_text          TEXT NOT NULL,
  batch_message_ids   UUID[] NOT NULL,
  llm_model           TEXT,
  prompt_version      TEXT,
  input_tokens        INT,
  output_tokens       INT,
  cost_usd            NUMERIC(10, 6),
  response_text       TEXT,
  status              TEXT NOT NULL DEFAULT 'pending',
                      -- pending | dispatched | completed | failed | cancelled
  n8n_execution_id    TEXT,
  error               TEXT,
  retry_count         INT NOT NULL DEFAULT 0,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  dispatched_at       TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  duration_ms         INT
);
CREATE INDEX ON api.turns (tenant_id, status, started_at DESC);
CREATE INDEX ON api.turns (tenant_id, subscriber_id, started_at DESC);

-- Dead Letter Queue
CREATE TABLE api.dead_letter_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  source          TEXT NOT NULL,  -- 'webhook' | 'n8n_dispatch' | 'manychat_send'
  payload         JSONB NOT NULL,
  error           TEXT NOT NULL,
  retry_count     INT NOT NULL,
  related_turn_id UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ,
  resolved_by     TEXT
);
CREATE INDEX ON api.dead_letter_queue (tenant_id, resolved_at NULLS FIRST);

-- Audit log (cambios en config, acciones admin)
CREATE TABLE api.audit_log (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   UUID,
  actor       TEXT NOT NULL,        -- 'system' | 'user:<id>' | 'n8n'
  action      TEXT NOT NULL,        -- 'pause_subscriber' | 'retry_turn' | etc.
  target_type TEXT,
  target_id   TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON api.audit_log (tenant_id, created_at DESC);

-- Idempotencia persistente (backup de Redis para auditoría)
CREATE TABLE api.processed_webhooks (
  hash        TEXT PRIMARY KEY,
  tenant_id   UUID NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- TTL manual: cron diario que borra > 7 días
```

### Row Level Security

```sql
ALTER TABLE api.subscribers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON api.subscribers
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
-- (repetir en messages_raw, conversations, turns, dead_letter_queue)
```

La API setea `SET LOCAL app.tenant_id = '...'` al inicio de cada transacción. Para queries cross-tenant (admin), conexión con rol distinto que bypassea RLS.

## Redis: claves y TTLs

Convención: `<concern>:<tenant_id>:<subscriber_id>` o `<concern>:<global_id>`.

| Clave | Tipo | TTL | Propósito |
|---|---|---|---|
| `idemp:{hash}` | STRING `1` | 24 h | Dedup de webhooks |
| `buffer:{tenant}:{subscriber}` | LIST de JSON | 120 s (defensivo) | Mensajes acumulados de la ráfaga |
| `debounce:{tenant}:{subscriber}` | STRING `<token-uuid>` | 8 s (= ventana) | Token único; se sobreescribe con cada mensaje |
| `firstmsg:{tenant}:{subscriber}` | STRING (timestamp ms) | 30 s (= max_wait) | Para forzar dispatch si max_wait se excede |
| `lock:turn:{tenant}:{subscriber}` | STRING `<turn_id>` | 90 s | Lock del turno mientras n8n procesa |
| `rate:{tenant}:{subscriber}` | sorted set | 60 s | Sliding window log para rate limit |
| `mem:{tenant}:{subscriber}` | LIST | 12 h | Memoria caliente del agente (gestionada por n8n Redis Chat Memory) |
| `bull:*` | varias | n/a | BullMQ (jobs delayed, completed, failed) |

### Estructura de un mensaje en el buffer

```json
{
  "id": "uuid del messages_raw",
  "external_message_id": "id_de_manychat_o_meta",
  "text": "hola",
  "ts": 1730000000000,
  "media_urls": []
}
```

### Patrón Lua atómico para el debounce

Para evitar race conditions, encapsular el "push + set token + schedule" en un script Lua atómico ejecutado desde Node:

```lua
-- KEYS[1] = buffer key
-- KEYS[2] = debounce key
-- KEYS[3] = firstmsg key
-- ARGV[1] = mensaje JSON
-- ARGV[2] = nuevo token UUID
-- ARGV[3] = debounce TTL ms
-- ARGV[4] = max_wait TTL ms
-- ARGV[5] = ts now ms
-- Devuelve: token, was_first (0/1), first_ts

redis.call('RPUSH', KEYS[1], ARGV[1])
redis.call('PEXPIRE', KEYS[1], 120000)

redis.call('SET', KEYS[2], ARGV[2], 'PX', tonumber(ARGV[3]))

local first_ts = redis.call('GET', KEYS[3])
local was_first = 0
if not first_ts then
  redis.call('SET', KEYS[3], ARGV[5], 'PX', tonumber(ARGV[4]))
  first_ts = ARGV[5]
  was_first = 1
end

return { ARGV[2], was_first, first_ts }
```

El worker que ejecuta el job consulta `firstmsg`: si han pasado más de `max_wait`, despacha aunque el token no coincida (ya no resetea infinito).

## Ciclo de vida de los datos

```
mensaje entrante
   ↓
messages_raw (insert) ────────────────────────┐
   ↓                                            │
buffer Redis (RPUSH)                            │ retención: 90 días raw
   ↓                                            │ luego archivar/borrar
debounce ventana                                │
   ↓                                            │
turn (insert pending) ─────────────────────────┤
   ↓                                            │
n8n dispatch                                    │ retención: 12 meses turns
   ↓                                            │ con resumen perpetuo
turn (update completed con coste)              │
   ↓                                            │
conversation.last_bot_msg_at update            │
   ↓                                            │
mem Redis (chat history) ──── TTL 12h ─────────┘
```

## Cambios alineados con docs 12-14 (funnel y triggers)

Las tablas anteriores se complementan con:

1. **`messages_raw`** añade columnas: `trigger_source TEXT`, `trigger_channel TEXT`, `trigger_ref TEXT`. Vienen del payload de ManyChat (doc 12).

2. **`turns`** añade columnas: `trigger_source TEXT`, `trigger_channel TEXT`. Heredadas del primer mensaje del batch para que el agente discrimine.

3. **`subscribers`** añade columna: `current_channel TEXT` (último canal por el que escribió, útil para enrutar audios/respuestas).

4. **Tablas nuevas del funnel** (definidas en doc 13):
   - `lead_stages` — etapa actual del lead, follow-ups, descalificación
   - `stage_transitions` — historial de cambios de etapa
   - `closers` — los humanos que reciben los leads en D
   - `follow_up_templates` — textos editables de los 8 follow-ups por etapa
   - `notifications` — centro de notificaciones para el dashboard

5. **Buffer Redis con canal en la clave** (alineado con doc 13): `buffer:{tenant}:{subscriber}:{channel}`. Permite que un mismo lead tenga conversaciones aisladas por canal (DM vs comentario).

## Backups

- Postgres: `pg_dump` diario + WAL archiving (PITR) si el cliente lo paga.
- Redis: AOF + snapshot diario. **Redis no es fuente de verdad**: si lo perdemos, los buffers se vacían y los mensajes en vuelo se pierden. Para minimizar el blast radius, persiste raw en Postgres **antes** de hacer ACK al webhook.
