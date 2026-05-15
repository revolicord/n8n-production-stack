CREATE TABLE IF NOT EXISTS "api"."followup_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stage_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sequence_number" integer NOT NULL,
	"delay_hours" integer NOT NULL,
	"type" text NOT NULL,
	"text_template" text,
	"flow_ns" text,
	"description" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api"."funnel_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"position" integer NOT NULL,
	"description" text,
	"max_followups" integer DEFAULT 3,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api"."lead_crons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"current_stage_id" uuid,
	"next_followup_at" timestamp with time zone,
	"next_sequence_number" integer DEFAULT 1,
	"is_active" boolean DEFAULT true,
	"archived_at" timestamp with time zone,
	"archive_reason" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api"."lead_followup_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"stage_id" uuid,
	"template_id" uuid,
	"sequence_number" integer NOT NULL,
	"text_sent" text,
	"sent_at" timestamp with time zone DEFAULT now(),
	"status" text DEFAULT 'sent',
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api"."lead_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"current_stage" text DEFAULT 'nuevo' NOT NULL,
	"current_stage_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api"."stage_flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stage_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"flow_ns" text NOT NULL,
	"description" text,
	"weight" integer DEFAULT 1,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api"."stage_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"turn_id" uuid,
	"from_stage" text NOT NULL,
	"to_stage" text NOT NULL,
	"reason" text,
	"agent_evidence" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api"."followup_templates" ADD CONSTRAINT "followup_templates_stage_id_funnel_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "api"."funnel_stages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api"."lead_crons" ADD CONSTRAINT "lead_crons_current_stage_id_funnel_stages_id_fk" FOREIGN KEY ("current_stage_id") REFERENCES "api"."funnel_stages"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api"."lead_followup_log" ADD CONSTRAINT "lead_followup_log_stage_id_funnel_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "api"."funnel_stages"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api"."lead_followup_log" ADD CONSTRAINT "lead_followup_log_template_id_followup_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "api"."followup_templates"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api"."lead_stages" ADD CONSTRAINT "lead_stages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api"."lead_stages" ADD CONSTRAINT "lead_stages_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "api"."subscribers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api"."lead_stages" ADD CONSTRAINT "lead_stages_current_stage_id_funnel_stages_id_fk" FOREIGN KEY ("current_stage_id") REFERENCES "api"."funnel_stages"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api"."stage_flows" ADD CONSTRAINT "stage_flows_stage_id_funnel_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "api"."funnel_stages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api"."stage_transitions" ADD CONSTRAINT "stage_transitions_turn_id_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "api"."turns"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "followup_templates_stage_seq_unique" ON "api"."followup_templates" USING btree ("stage_id","sequence_number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "funnel_stages_tenant_slug_unique" ON "api"."funnel_stages" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "funnel_stages_tenant_active_idx" ON "api"."funnel_stages" USING btree ("tenant_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lead_crons_tenant_sub_conv_unique" ON "api"."lead_crons" USING btree ("tenant_id","subscriber_id","conversation_id");--> statement-breakpoint
DROP INDEX IF EXISTS "api"."lead_crons_due_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_crons_due_idx" ON "api"."lead_crons" USING btree ("next_followup_at") WHERE is_active = TRUE AND next_followup_at IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_followup_log_sub_conv_idx" ON "api"."lead_followup_log" USING btree ("subscriber_id","conversation_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lead_stages_tenant_subscriber_unique" ON "api"."lead_stages" USING btree ("tenant_id","subscriber_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stage_flows_stage_active_idx" ON "api"."stage_flows" USING btree ("stage_id","is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stage_transitions_tenant_sub_idx" ON "api"."stage_transitions" USING btree ("tenant_id","subscriber_id","created_at");--> statement-breakpoint
-- ADR-0014: trigger de sincronía lead_stages.current_stage ↔ current_stage_id
CREATE OR REPLACE FUNCTION api.sync_lead_stage_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.current_stage IS DISTINCT FROM OLD.current_stage THEN
    SELECT id INTO NEW.current_stage_id
    FROM api.funnel_stages
    WHERE slug = NEW.current_stage
      AND tenant_id = NEW.tenant_id
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_sync_lead_stage_id
  BEFORE UPDATE ON api.lead_stages
  FOR EACH ROW EXECUTE FUNCTION api.sync_lead_stage_id();--> statement-breakpoint
-- ADR-0014: backfill current_stage_id desde lead_stages.current_stage
-- NOTA: ejecutar DESPUÉS del seed de funnel_stages con los IDs reales del tenant
-- UPDATE api.lead_stages ls
-- SET current_stage_id = fs.id
-- FROM api.funnel_stages fs
-- WHERE fs.slug = ls.current_stage
--   AND fs.tenant_id = ls.tenant_id
--   AND ls.current_stage_id IS NULL;