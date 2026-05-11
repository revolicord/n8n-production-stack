CREATE SCHEMA IF NOT EXISTS "api";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api"."conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"last_user_msg_at" timestamp with time zone,
	"last_bot_msg_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"summary" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api"."dead_letter_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source" text NOT NULL,
	"payload" jsonb NOT NULL,
	"error" text NOT NULL,
	"retry_count" integer NOT NULL,
	"related_turn_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api"."messages_raw" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"channel" text DEFAULT 'instagram' NOT NULL,
	"external_message_id" text,
	"idempotency_hash" text NOT NULL,
	"direction" text NOT NULL,
	"payload" jsonb NOT NULL,
	"text" text,
	"has_media" boolean DEFAULT false NOT NULL,
	"media_urls" text[],
	"trigger_source" text,
	"trigger_channel" text,
	"trigger_ref" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api"."subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"manychat_subscriber_id" text NOT NULL,
	"ig_user_id" text,
	"ig_username" text,
	"display_name" text,
	"locale" text,
	"current_channel" text,
	"opt_ins" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"paused_until" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api"."tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"manychat_account_id" text,
	"manychat_api_key_encrypted" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api"."turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"batch_size" integer NOT NULL,
	"batch_text" text NOT NULL,
	"batch_message_ids" uuid[] NOT NULL,
	"llm_model" text,
	"prompt_version" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(10, 6),
	"response_text" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"n8n_execution_id" text,
	"error" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"trigger_source" text,
	"trigger_channel" text,
	"parent_turn_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"duration_ms" integer
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api"."subscribers" ADD CONSTRAINT "subscribers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api"."turns" ADD CONSTRAINT "turns_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "api"."conversations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_tenant_sub_status_idx" ON "api"."conversations" USING btree ("tenant_id","subscriber_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_tenant_last_user_msg_idx" ON "api"."conversations" USING btree ("tenant_id","last_user_msg_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dlq_tenant_resolved_idx" ON "api"."dead_letter_queue" USING btree ("tenant_id","resolved_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "messages_raw_idempotency_unique" ON "api"."messages_raw" USING btree ("tenant_id","idempotency_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_raw_tenant_subscriber_idx" ON "api"."messages_raw" USING btree ("tenant_id","subscriber_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subscribers_tenant_manychat_unique" ON "api"."subscribers" USING btree ("tenant_id","manychat_subscriber_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscribers_tenant_status_idx" ON "api"."subscribers" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscribers_tenant_last_seen_idx" ON "api"."subscribers" USING btree ("tenant_id","last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_slug_unique" ON "api"."tenants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "turns_tenant_status_idx" ON "api"."turns" USING btree ("tenant_id","status","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "turns_tenant_sub_idx" ON "api"."turns" USING btree ("tenant_id","subscriber_id","started_at");