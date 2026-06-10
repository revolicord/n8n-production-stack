-- Escalado a humano: tabla de notificaciones (audio / keyword / agente)
-- Producidas por webhook-manychat o por n8n (tool notify_human); el worker
-- 'notify' las entrega a Telegram y guarda chat/message id para editar luego.
CREATE TABLE IF NOT EXISTS "api"."notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "subscriber_id" uuid NOT NULL,
  "conversation_id" uuid,
  "turn_id" uuid,
  "kind" text NOT NULL,
  "source" text NOT NULL,
  "reason" text,
  "summary" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "telegram_chat_id" text,
  "telegram_message_id" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone,
  "resolved_by" text
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "api"."notifications"
    ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "api"."tenants"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "api"."notifications"
    ADD CONSTRAINT "notifications_subscriber_id_subscribers_id_fk"
    FOREIGN KEY ("subscriber_id") REFERENCES "api"."subscribers"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_tenant_status_idx"
  ON "api"."notifications" ("tenant_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_pending_idx"
  ON "api"."notifications" ("tenant_id", "created_at")
  WHERE status = 'pending';
