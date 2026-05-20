-- Tablas usadas directamente por los workflows de n8n (no por el API/ORM).
-- Estaban creadas a mano en producción y faltaban en las migraciones, por lo que
-- un servidor nuevo no las tendría. Migración idempotente.
--
--   - lead_content_sent: log de qué contenido (flow) se envió a cada lead, para
--     historial y deduplicación (nodos n8n 00d-get-content-history / 00e-mark-content-responded).
--   - stage_transitions_map: mapa configurable de transiciones de etapa válidas.

CREATE TABLE IF NOT EXISTS "api"."lead_content_sent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"stage_slug" text NOT NULL,
	"slug_id" text NOT NULL,
	"flow_ns" text NOT NULL,
	"turn_id" uuid,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lead_responded" boolean DEFAULT false NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lcs_lookup" ON "api"."lead_content_sent" USING btree ("subscriber_id","conversation_id","stage_slug","sent_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lcs_pending_response" ON "api"."lead_content_sent" USING btree ("subscriber_id","conversation_id") WHERE lead_responded = false;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api"."stage_transitions_map" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"from_stage_slug" text NOT NULL,
	"to_stage_slug" text NOT NULL,
	"when_to_use" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api"."stage_transitions_map" ADD CONSTRAINT "stage_transitions_map_tenant_from_to_unique" UNIQUE ("tenant_id","from_stage_slug","to_stage_slug");
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_stm_lookup" ON "api"."stage_transitions_map" USING btree ("tenant_id","from_stage_slug") WHERE is_active = true;
