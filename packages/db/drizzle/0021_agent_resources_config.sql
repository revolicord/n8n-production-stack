ALTER TABLE "api"."agent_resources" ADD COLUMN IF NOT EXISTS "config" jsonb;
ALTER TABLE "api"."agent_turn_traces" ADD COLUMN IF NOT EXISTS "objection_detected" jsonb;
