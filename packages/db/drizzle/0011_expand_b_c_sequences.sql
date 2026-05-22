-- Migration 0011: Expandir Fase B y Fase C a 8 templates type='content'
-- Fase B: tenía seq 1-2 (text) → pasa a 1-8 (content)
-- Fase C: tenía seq 1 (text) → pasa a 1-8 (content)

DO $$
DECLARE
  v_tenant_id UUID;
  v_stage_b   UUID;
  v_stage_c   UUID;
BEGIN
  SELECT id INTO v_tenant_id FROM api.tenants WHERE slug = 'quantum-creators';
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant quantum-creators not found';
  END IF;

  SELECT id INTO v_stage_b FROM api.funnel_stages WHERE tenant_id = v_tenant_id AND slug = 'B';
  SELECT id INTO v_stage_c FROM api.funnel_stages WHERE tenant_id = v_tenant_id AND slug = 'C';

  -- Ampliar max_followups a 8 para ambas etapas
  UPDATE api.funnel_stages
  SET max_followups = 8
  WHERE id IN (v_stage_b, v_stage_c);

  -- Convertir templates existentes a type='content'
  UPDATE api.followup_templates
  SET type = 'content', text_template = NULL
  WHERE stage_id IN (v_stage_b, v_stage_c);

  -- Fase C: insertar templates 2-8
  INSERT INTO api.followup_templates
    (stage_id, tenant_id, sequence_number, delay_minutes, type, description)
  VALUES
    (v_stage_c, v_tenant_id, 2,  2880,  'content', 'Follow-up C #2'),
    (v_stage_c, v_tenant_id, 3,  4320,  'content', 'Follow-up C #3'),
    (v_stage_c, v_tenant_id, 4,  5760,  'content', 'Follow-up C #4'),
    (v_stage_c, v_tenant_id, 5,  7200,  'content', 'Follow-up C #5'),
    (v_stage_c, v_tenant_id, 6,  8640,  'content', 'Follow-up C #6'),
    (v_stage_c, v_tenant_id, 7,  10080, 'content', 'Follow-up C #7'),
    (v_stage_c, v_tenant_id, 8,  11520, 'content', 'Follow-up C #8')
  ON CONFLICT (stage_id, sequence_number) DO UPDATE
    SET type = 'content', text_template = NULL;

  -- Fase B: insertar templates 3-8 (1-2 ya existen, actualizados arriba)
  INSERT INTO api.followup_templates
    (stage_id, tenant_id, sequence_number, delay_minutes, type, description)
  VALUES
    (v_stage_b, v_tenant_id, 3,  4320,  'content', 'Follow-up B #3'),
    (v_stage_b, v_tenant_id, 4,  5760,  'content', 'Follow-up B #4'),
    (v_stage_b, v_tenant_id, 5,  7200,  'content', 'Follow-up B #5'),
    (v_stage_b, v_tenant_id, 6,  8640,  'content', 'Follow-up B #6'),
    (v_stage_b, v_tenant_id, 7,  10080, 'content', 'Follow-up B #7'),
    (v_stage_b, v_tenant_id, 8,  11520, 'content', 'Follow-up B #8')
  ON CONFLICT (stage_id, sequence_number) DO UPDATE
    SET type = 'content', text_template = NULL;

  RAISE NOTICE 'Migración 0011 completada — B: 8 templates, C: 8 templates';
END $$;
