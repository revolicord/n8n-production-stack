-- ADR-0025: observabilidad del motor — agent_turn_traces reemplaza agent_shadow_runs.
-- Una fila por ejecución de turno (mode: live|shadow|replay): traza legible
-- equivalente a una "execution" de n8n, consultable por SQL.

DROP TABLE IF EXISTS api.agent_shadow_runs;
--> statement-breakpoint
CREATE TABLE api.agent_turn_traces (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  turn_id                UUID        NOT NULL,
  tenant_id              UUID        NOT NULL,
  conversation_id        UUID,
  subscriber_id          UUID,
  mode                   TEXT        NOT NULL,
  status                 TEXT        NOT NULL,
  input                  JSONB,
  context_snapshot       JSONB,
  prompt                 JSONB,
  reasoning              TEXT,
  commands               JSONB,
  action_results         JSONB,
  flow_path              JSONB,
  response_texts         JSONB,
  final_stage            TEXT,
  dialogue_state_before  JSONB,
  dialogue_state_after   JSONB,
  error                  JSONB,
  metrics                JSONB,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX agent_turn_traces_turn_mode_uniq
  ON api.agent_turn_traces (turn_id, mode);
--> statement-breakpoint
CREATE INDEX agent_turn_traces_tenant_created_idx
  ON api.agent_turn_traces (tenant_id, created_at);
--> statement-breakpoint
CREATE INDEX agent_turn_traces_tenant_sub_idx
  ON api.agent_turn_traces (tenant_id, subscriber_id, created_at);
--> statement-breakpoint
CREATE INDEX agent_turn_traces_tenant_status_idx
  ON api.agent_turn_traces (tenant_id, status);
