CREATE TABLE api.followup_messages (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   UUID        NOT NULL REFERENCES api.followup_templates(id) ON DELETE CASCADE,
  tenant_id     UUID        NOT NULL,
  message_type  TEXT        NOT NULL CHECK (message_type IN ('text', 'image')),
  text_content  TEXT,
  media_url     TEXT,
  sort_order    INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX followup_messages_tpl_order_unique
  ON api.followup_messages (template_id, sort_order);

CREATE INDEX followup_messages_template_idx
  ON api.followup_messages (template_id);
