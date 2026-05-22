-- Seed: Funnel stages + followup_templates para tenant Quantum Creators
-- Ejecutar DESPUÉS de tener el tenant_id real de la BD:
--   SELECT id FROM api.tenants WHERE slug = 'quantum-creators';
-- Reemplazar TENANT_ID con el UUID obtenido.
--
-- Orden de ejecución:
--   1. Este archivo (funnel_stages + stage_flows)
--   2. El backfill comentado en la migración 0002_polite_groot.sql

DO $$
DECLARE
  v_tenant_id  UUID := '<TENANT_ID>';  -- reemplazar con el UUID real
  v_stage_a    UUID;
  v_stage_ms   UUID;
  v_stage_b    UUID;
  v_stage_c    UUID;
  v_stage_d    UUID;
BEGIN

-- ──────────────────────────────────────────────────────────────
-- funnel_stages — etapas canónicas QC (A/MS/B/C/D)
-- ──────────────────────────────────────────────────────────────
INSERT INTO api.funnel_stages (tenant_id, slug, display_name, position, description, max_followups)
VALUES
  (v_tenant_id, 'A',  'Enganche',         1, 'Video de enganche 25s — primer contacto, pedir pulgar arriba',          3),
  (v_tenant_id, 'MS', 'VSL',              2, 'VSL 1:58 — enviar cuando confirmó ver el Video 1',                     3),
  (v_tenant_id, 'B',  'Calendly',         3, 'Enviar link de Calendly por texto — no hay flow multimedia',            2),
  (v_tenant_id, 'C',  'Llamada agendada', 4, 'Lead con llamada agendada — esperar o confirmar',                      1),
  (v_tenant_id, 'D',  'Cliente',          5, 'Cerrado — sin follow-ups automáticos',                                  0)
ON CONFLICT (tenant_id, slug) DO NOTHING;

-- Recuperar IDs
SELECT id INTO v_stage_a  FROM api.funnel_stages WHERE tenant_id = v_tenant_id AND slug = 'A';
SELECT id INTO v_stage_ms FROM api.funnel_stages WHERE tenant_id = v_tenant_id AND slug = 'MS';
SELECT id INTO v_stage_b  FROM api.funnel_stages WHERE tenant_id = v_tenant_id AND slug = 'B';
SELECT id INTO v_stage_c  FROM api.funnel_stages WHERE tenant_id = v_tenant_id AND slug = 'C';
SELECT id INTO v_stage_d  FROM api.funnel_stages WHERE tenant_id = v_tenant_id AND slug = 'D';

-- ──────────────────────────────────────────────────────────────
-- stage_flows — flows ManyChat por etapa
-- Reemplazar los PENDIENTE_* con los ns reales de ManyChat QC
-- Ver n8n/flows-catalog.md para reconciliar los namespaces
-- ──────────────────────────────────────────────────────────────
INSERT INTO api.stage_flows (stage_id, tenant_id, flow_ns, description, weight)
VALUES
  (v_stage_a,  v_tenant_id, 'PENDIENTE_ns_video_hook', 'Video de enganche 25s',   1),
  (v_stage_ms, v_tenant_id, 'PENDIENTE_ns_video_vsl',  'VSL 1:58 completa',       1)
ON CONFLICT DO NOTHING;
-- Etapas B, C, D: sin flow multimedia, el agente envía texto directo

-- ──────────────────────────────────────────────────────────────
-- followup_templates — secuencias de reactivación por etapa
-- ──────────────────────────────────────────────────────────────

-- Etapa A — 3 follow-ups en días 1, 2, 3
INSERT INTO api.followup_templates
  (stage_id, tenant_id, sequence_number, delay_minutes, type, text_template, description)
VALUES
  (v_stage_a, v_tenant_id, 1, 1440, 'text',
   'Oye {{name}}, ¿pudiste ver el video que te mandé? 👀',
   'Follow-up A #1 — 24h sin respuesta'),
  (v_stage_a, v_tenant_id, 2, 2880, 'text',
   'Hola {{name}}, no quiero molestarte pero me gustaría saber qué te pareció 🙌',
   'Follow-up A #2 — 48h adicionales sin respuesta'),
  (v_stage_a, v_tenant_id, 3, 4320, 'text',
   '{{name}}, último intento. Si no es el momento, sin problema. Cuando quieras aquí estaré 💪',
   'Follow-up A #3 — cierre de secuencia')
ON CONFLICT (stage_id, sequence_number) DO NOTHING;

-- Etapa MS — 3 follow-ups en días 1, 2, 3
INSERT INTO api.followup_templates
  (stage_id, tenant_id, sequence_number, delay_minutes, type, text_template, description)
VALUES
  (v_stage_ms, v_tenant_id, 1, 1440, 'text',
   'Hey {{name}}, ¿ya pudiste ver la presentación completa? 🎥',
   'Follow-up MS #1 — 24h sin respuesta'),
  (v_stage_ms, v_tenant_id, 2, 2880, 'text',
   '{{name}}, quería saber si tuviste alguna duda después de ver el video 🤔',
   'Follow-up MS #2 — 48h adicionales sin respuesta'),
  (v_stage_ms, v_tenant_id, 3, 4320, 'text',
   '{{name}}, entiendo que estás ocupado. Cuando puedas, aquí estoy para resolver tus preguntas 💬',
   'Follow-up MS #3 — cierre de secuencia')
ON CONFLICT (stage_id, sequence_number) DO NOTHING;

-- Etapa B — 2 follow-ups en días 1, 2
INSERT INTO api.followup_templates
  (stage_id, tenant_id, sequence_number, delay_minutes, type, text_template, description)
VALUES
  (v_stage_b, v_tenant_id, 1, 1440, 'text',
   '{{name}}, ¿pudiste agendar tu llamada? 📅 Aquí el link por si lo necesitas',
   'Follow-up B #1 — 24h sin agendar'),
  (v_stage_b, v_tenant_id, 2, 2880, 'text',
   '{{name}}, los slots de esta semana se están llenando. ¿Te gustaría reservar el tuyo? 🚀',
   'Follow-up B #2 — cierre de secuencia')
ON CONFLICT (stage_id, sequence_number) DO NOTHING;

-- Etapa C — 1 follow-up de confirmación
INSERT INTO api.followup_templates
  (stage_id, tenant_id, sequence_number, delay_minutes, type, text_template, description)
VALUES
  (v_stage_c, v_tenant_id, 1, 120, 'text',
   '{{name}}, te confirmo tu llamada agendada 🎯 ¿Nos vemos a la hora acordada?',
   'Follow-up C #1 — confirmación de llamada')
ON CONFLICT (stage_id, sequence_number) DO NOTHING;

-- Etapa D — sin follow-ups (max_followups = 0)

RAISE NOTICE 'Seed QC completado. Stages: A=%, MS=%, B=%, C=%, D=%',
  v_stage_a, v_stage_ms, v_stage_b, v_stage_c, v_stage_d;

END $$;

-- ──────────────────────────────────────────────────────────────
-- Backfill: sincronizar lead_stages.current_stage_id
-- Ejecutar DESPUÉS de este seed
-- ──────────────────────────────────────────────────────────────
-- UPDATE api.lead_stages ls
-- SET current_stage_id = fs.id
-- FROM api.funnel_stages fs
-- WHERE fs.slug = ls.current_stage
--   AND fs.tenant_id = ls.tenant_id
--   AND ls.current_stage_id IS NULL;
