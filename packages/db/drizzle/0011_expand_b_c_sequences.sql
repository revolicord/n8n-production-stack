-- Migration 0011: Expandir Fase B y Fase C a 8 templates type='content'
-- Fase B: tenía seq 1-2 (text) → pasa a 1-8 (content)
-- Fase C: tenía seq 1 (text) → pasa a 1-8 (content)
-- Opera sobre todos los tenants que tengan etapas B/C.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT fs.id AS stage_id, fs.tenant_id, fs.slug AS stage_slug
    FROM api.funnel_stages fs
    WHERE fs.slug IN ('B', 'C')
  LOOP
    -- Ampliar max_followups a 8
    UPDATE api.funnel_stages
    SET max_followups = 8
    WHERE id = r.stage_id;

    -- Convertir templates existentes a type='content'
    UPDATE api.followup_templates
    SET type = 'content', text_template = NULL
    WHERE stage_id = r.stage_id;

    -- Insertar slots faltantes según la etapa
    IF r.stage_slug = 'C' THEN
      INSERT INTO api.followup_templates
        (stage_id, tenant_id, sequence_number, delay_minutes, type, description)
      VALUES
        (r.stage_id, r.tenant_id, 2,  2880,  'content', 'Follow-up C #2'),
        (r.stage_id, r.tenant_id, 3,  4320,  'content', 'Follow-up C #3'),
        (r.stage_id, r.tenant_id, 4,  5760,  'content', 'Follow-up C #4'),
        (r.stage_id, r.tenant_id, 5,  7200,  'content', 'Follow-up C #5'),
        (r.stage_id, r.tenant_id, 6,  8640,  'content', 'Follow-up C #6'),
        (r.stage_id, r.tenant_id, 7,  10080, 'content', 'Follow-up C #7'),
        (r.stage_id, r.tenant_id, 8,  11520, 'content', 'Follow-up C #8')
      ON CONFLICT (stage_id, sequence_number) DO UPDATE
        SET type = 'content', text_template = NULL;
    ELSIF r.stage_slug = 'B' THEN
      INSERT INTO api.followup_templates
        (stage_id, tenant_id, sequence_number, delay_minutes, type, description)
      VALUES
        (r.stage_id, r.tenant_id, 3,  4320,  'content', 'Follow-up B #3'),
        (r.stage_id, r.tenant_id, 4,  5760,  'content', 'Follow-up B #4'),
        (r.stage_id, r.tenant_id, 5,  7200,  'content', 'Follow-up B #5'),
        (r.stage_id, r.tenant_id, 6,  8640,  'content', 'Follow-up B #6'),
        (r.stage_id, r.tenant_id, 7,  10080, 'content', 'Follow-up B #7'),
        (r.stage_id, r.tenant_id, 8,  11520, 'content', 'Follow-up B #8')
      ON CONFLICT (stage_id, sequence_number) DO UPDATE
        SET type = 'content', text_template = NULL;
    END IF;

    RAISE NOTICE 'Etapa % (tenant %) — 8 templates expandidos', r.stage_slug, r.tenant_id;
  END LOOP;
END $$;
