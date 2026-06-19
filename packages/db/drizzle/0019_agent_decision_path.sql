ALTER TABLE api.agent_turn_traces
  ADD COLUMN decision_path TEXT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_turn_traces_tenant_decision_idx"
  ON api.agent_turn_traces (tenant_id, decision_path, created_at);
