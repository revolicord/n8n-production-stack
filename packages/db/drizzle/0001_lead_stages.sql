CREATE TABLE "api"."lead_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"current_stage" text DEFAULT 'nuevo' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api"."stage_transitions" (
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
 ALTER TABLE "api"."stage_transitions" ADD CONSTRAINT "stage_transitions_turn_id_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "api"."turns"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lead_stages_tenant_subscriber_unique" ON "api"."lead_stages" USING btree ("tenant_id","subscriber_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stage_transitions_tenant_sub_idx" ON "api"."stage_transitions" USING btree ("tenant_id","subscriber_id","created_at");
