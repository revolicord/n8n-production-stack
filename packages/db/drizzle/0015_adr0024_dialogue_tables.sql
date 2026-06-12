-- ADR-0024: motor de diálogo declarativo — tablas Fase 1
-- flow_definitions, dialogue_states, domain_events, agent_shadow_runs

-- flow_definitions: flows declarativos versionados por tenant
CREATE TABLE api.flow_definitions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES api.tenants(id) ON DELETE CASCADE,
  flow_id         TEXT        NOT NULL,
  version         INTEGER     NOT NULL DEFAULT 1,
  definition      JSONB       NOT NULL,
  active          BOOLEAN     NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX flow_definitions_tenant_flow_version_unique
  ON api.flow_definitions (tenant_id, flow_id, version);

-- Solo un flow activo por (tenant, flow_id)
CREATE UNIQUE INDEX flow_definitions_one_active_unique
  ON api.flow_definitions (tenant_id, flow_id)
  WHERE active = true;

-- dialogue_states: un estado de diálogo por conversación (fuente de verdad durable)
CREATE TABLE api.dialogue_states (
  conversation_id UUID        PRIMARY KEY REFERENCES api.conversations(id) ON DELETE CASCADE,
  tenant_id       UUID        NOT NULL,
  stack           JSONB       NOT NULL DEFAULT '[]'::jsonb,
  slots           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  repair_context  JSONB,
  last_turn_id    UUID,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX dialogue_states_tenant_idx ON api.dialogue_states (tenant_id);

-- domain_events: outbox mínimo (lead.stage_changed, conversation.escalated, content.sent, ...)
CREATE TABLE api.domain_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL,
  type         TEXT        NOT NULL,
  payload      JSONB       NOT NULL,
  turn_id      UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX domain_events_tenant_type_idx ON api.domain_events (tenant_id, type, created_at);

-- agent_shadow_runs: resultados dry-run del agente en Fase 3 (droppable tras cutover)
CREATE TABLE api.agent_shadow_runs (
  turn_id        UUID        PRIMARY KEY,
  tenant_id      UUID        NOT NULL,
  commands       JSONB       NOT NULL,
  response_texts JSONB       NOT NULL,
  final_stage    TEXT,
  dialogue_state JSONB,
  error          TEXT,
  duration_ms    INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
