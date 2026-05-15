-- ADR-0016: Flow Registry — añade campos semánticos a stage_flows
-- Permite separar content_description de usage_condition y soportar
-- naming convention QC_{STAGE}_{MEDIA}_{DESC}_{VARIANT} + sync desde ManyChat API.

ALTER TABLE api.stage_flows
  ADD COLUMN IF NOT EXISTS human_name          text,
  ADD COLUMN IF NOT EXISTS media_type          text,
  ADD COLUMN IF NOT EXISTS content_description text,
  ADD COLUMN IF NOT EXISTS usage_condition     text,
  ADD COLUMN IF NOT EXISTS variant_group       text,
  ADD COLUMN IF NOT EXISTS pending_ns          text,
  ADD COLUMN IF NOT EXISTS synced_at           timestamptz;

-- Índice para buscar por human_name (usado en el sync endpoint)
CREATE INDEX IF NOT EXISTS stage_flows_human_name_tenant_idx
  ON api.stage_flows (tenant_id, human_name);

-- Índice para buscar flows pendientes de aprobación
CREATE INDEX IF NOT EXISTS stage_flows_pending_ns_idx
  ON api.stage_flows (tenant_id, pending_ns)
  WHERE pending_ns IS NOT NULL;

-- Poblar human_name con la descripción existente para los 2 flows actuales
-- (se actualizarán con el nombre real tras renombrar en ManyChat)
UPDATE api.stage_flows
SET human_name = CASE
  WHEN flow_ns = 'PENDIENTE_ns_video_hook' THEN 'QC_A_video_hook_v1'
  WHEN flow_ns = 'PENDIENTE_ns_video_vsl'  THEN 'QC_MS_audio_vsl'
  ELSE NULL
END
WHERE tenant_id = '9d338f06-59c6-47bd-b3d7-4e3631ff4e75'
  AND human_name IS NULL;
