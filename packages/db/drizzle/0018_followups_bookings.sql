ALTER TABLE api.lead_followup_log
  ADD COLUMN error TEXT;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS api.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  subscriber_id UUID NOT NULL,
  conversation_id UUID,
  provider TEXT NOT NULL DEFAULT 'calendly',
  event_uri TEXT,
  invitee_uri TEXT NOT NULL,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  join_url TEXT,
  reschedule_url TEXT,
  cancel_url TEXT,
  invitee_email TEXT,
  timezone TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  booked_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS bookings_tenant_invitee_unique
  ON api.bookings (tenant_id, invitee_uri);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bookings_tenant_status_start_idx
  ON api.bookings (tenant_id, status, start_time);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS api.booking_reminder_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  offset_minutes INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'reminder',
  type TEXT NOT NULL,
  text_template TEXT,
  flow_ns TEXT,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS booking_reminder_templates_tenant_active_idx
  ON api.booking_reminder_templates (tenant_id, is_active);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS api.booking_reminder_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  booking_id UUID NOT NULL REFERENCES api.bookings(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES api.booking_reminder_templates(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'sent',
  error TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS booking_reminder_log_booking_template_unique
  ON api.booking_reminder_log (booking_id, template_id);
