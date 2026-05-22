CREATE TABLE api.agent_resources (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID         NOT NULL REFERENCES api.tenants(id) ON DELETE CASCADE,
  category      TEXT         NOT NULL CHECK (category IN ('cierre', 'objecion', 'general')),
  slug          TEXT         NOT NULL,
  display_name  TEXT         NOT NULL,
  trigger_hint  TEXT,
  text_content  TEXT,
  media_url     TEXT,
  sort_order    INTEGER      NOT NULL DEFAULT 0,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX agent_resources_tenant_slug_unique
  ON api.agent_resources (tenant_id, slug);

CREATE INDEX agent_resources_tenant_category_idx
  ON api.agent_resources (tenant_id, category, is_active);
