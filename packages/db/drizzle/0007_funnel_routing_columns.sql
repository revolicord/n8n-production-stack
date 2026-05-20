-- Columnas de routing/contenido añadidas a mano en producción y que faltaban en
-- las migraciones (las usan los workflows de n8n: Get Stage Config, Build Context,
-- Router). Sin esto un servidor nuevo no tendría estas columnas. Idempotente.
--
--   - funnel_stages.goal: objetivo de la etapa (texto para el prompt del agente).
--   - funnel_stages.valid_next_stages: transiciones válidas (slugs) desde la etapa.
--   - stage_flows.slug_id: identificador corto del contenido (usado por lead_content_sent).

ALTER TABLE "api"."funnel_stages"
  ADD COLUMN IF NOT EXISTS "goal"              text,
  ADD COLUMN IF NOT EXISTS "valid_next_stages" text[] NOT NULL DEFAULT '{}'::text[];
--> statement-breakpoint
ALTER TABLE "api"."stage_flows"
  ADD COLUMN IF NOT EXISTS "slug_id" text;
