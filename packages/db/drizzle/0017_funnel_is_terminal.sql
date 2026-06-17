ALTER TABLE api.funnel_stages
  ADD COLUMN is_terminal BOOLEAN NOT NULL DEFAULT false;
