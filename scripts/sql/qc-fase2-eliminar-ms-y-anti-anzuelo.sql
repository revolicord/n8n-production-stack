-- ============================================================================
-- Fase 2 (estructura) — tenant Quantum Creators / revolicord
-- Deriva de docs/business-rules-qc.md §6.
--
-- Qué hace:
--   1. Mueve el contenido core (audio_prevsl + vsl_resultados) de la etapa MS → B.
--   2. Desactiva las transiciones de MS y crea A→B directa.
--   3. Desactiva la transición blanda C→D (anti-anzuelo: C→D solo por webhook).
--   4. Ajusta valid_next_stages de A (MS → B).
--   5. Desactiva la etapa MS (is_active=false; NO se borra, para no romper FKs/historial).
--
-- Seguridad: transaccional. MS se desactiva, no se elimina. Verificado: 0 leads vivos
-- en MS al momento de redactar (todos los current_stage de leads activos != MS).
-- Reversible: reactivar MS y sus transiciones, y devolver el stage_id del contenido.
--
-- IDs (tenant revolicord = 9d338f06-59c6-47bd-b3d7-4e3631ff4e75):
--   A  = 9719f172-c902-4b28-85a4-3affcd0db12e
--   MS = dedf46b8-965a-4d19-97f4-fecff3c5dbcd
--   B  = 18a733d0-7af7-41e6-a2fb-c32a26bc69a3
--   C  = f8f2cb25-7a48-4ddc-ac96-0edcaa3ae82c
-- ============================================================================

BEGIN;

-- 1. Contenido core: MS → B (el VSL ahora pertenece a la etapa B "VSL enviada")
UPDATE api.stage_flows
SET stage_id = '18a733d0-7af7-41e6-a2fb-c32a26bc69a3'  -- B
WHERE id IN (
  'addd9575-1f70-4f50-ab45-7fae487e738f',  -- audio_prevsl
  '368c07c9-f3ec-4e8b-be33-ad463e484833'   -- vsl_resultados
);

-- 2. Desactivar transiciones de MS y la blanda C→D
UPDATE api.stage_transitions_map
SET is_active = false, updated_at = now()
WHERE id IN (
  'de3942bb-9e36-4ec3-b4c1-80f6d4c94af4',  -- A → MS
  'a17b0866-d699-4f90-907a-7998b31de833',  -- MS → B
  '81ddf6e9-2b6e-49ea-b8ce-b86ce12cb531',  -- MS → disqualified
  '02759c94-0242-4cea-89d8-f73463c628a5'   -- C → D (blanda / verbal — anti-anzuelo)
);

-- 3. Crear A→B directa (reemplaza A→MS→B)
INSERT INTO api.stage_transitions_map (tenant_id, from_stage_slug, to_stage_slug, when_to_use, is_active)
VALUES (
  '9d338f06-59c6-47bd-b3d7-4e3631ff4e75',
  'A', 'B',
  'Lead da una señal positiva al hook (pulgar arriba, "sí", "ya lo vi", "me interesa"). Al avanzar, la cascada A→B entrega el audio pre-VSL + la VSL. Si el lead se desvía con miedo o duda, NO avances: el LLM lo reconduce con registro suave.',
  true
)
ON CONFLICT (tenant_id, from_stage_slug, to_stage_slug)
DO UPDATE SET is_active = true, when_to_use = EXCLUDED.when_to_use, updated_at = now();

-- 4. valid_next_stages de A: MS → B
UPDATE api.funnel_stages
SET valid_next_stages = '{B,disqualified}', updated_at = now()
WHERE id = '9719f172-c902-4b28-85a4-3affcd0db12e';  -- A

-- 5. Desactivar la etapa MS (residuo del motor outbound; ver business-rules-qc.md §1)
UPDATE api.funnel_stages
SET is_active = false, updated_at = now()
WHERE id = 'dedf46b8-965a-4d19-97f4-fecff3c5dbcd';  -- MS

COMMIT;
