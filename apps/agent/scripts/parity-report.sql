-- Parity Report ADR-0024 §6 — Shadow Mode vs n8n
-- Uso: psql $DATABASE_URL -f parity-report.sql
--
-- Variables de entorno opcionales (usar \set en psql o reemplazar manualmente):
--   :days_back   — ventana de análisis en días (default: 5)
--
-- Criterios de cutover (§6):
--   C1: 100% de transiciones de etapa coinciden
--   C2: ≥90% de turnos con acción de negocio equivalente
--   C3: revisión humana muestral de 30 turnos divergentes
--   C4: cero errores de plataforma en los últimos 3 días

\set days_back 5

-- ═══════════════════════════════════════════════════════════════════════════
-- BASE: turns con shadow run en la ventana de análisis
-- ═══════════════════════════════════════════════════════════════════════════

WITH window_turns AS (
  SELECT
    asr.turn_id,
    asr.tenant_id,
    asr.commands,
    asr.response_texts,
    asr.final_stage         AS shadow_stage,
    asr.error               AS shadow_error,
    asr.duration_ms         AS shadow_ms,
    t.response_text         AS real_response,
    t.status                AS real_status,
    t.subscriber_id,
    t.conversation_id,
    t.started_at
  FROM api.agent_shadow_runs asr
  JOIN api.turns t ON t.id = asr.turn_id
  WHERE asr.created_at >= now() - (:days_back || ' days')::interval
    AND asr.error IS NULL
),

-- Transiciones reales registradas en stage_transitions por turn_id
real_transitions AS (
  SELECT
    st.turn_id,
    st.from_stage,
    st.to_stage
  FROM api.stage_transitions st
  WHERE st.turn_id IN (SELECT turn_id FROM window_turns)
),

-- Comandos ChangeStage emitidos por el shadow agent (del JSONB commands)
shadow_transitions AS (
  SELECT
    wt.turn_id,
    cmd->>'to_stage' AS shadow_to_stage
  FROM window_turns wt,
       jsonb_array_elements(wt.commands) AS cmd
  WHERE cmd->>'type' = 'ChangeStage'
),

-- ═══════════════════════════════════════════════════════════════════════════
-- CRITERIO 1: coincidencia de transición de etapa (debe ser 100%)
-- ═══════════════════════════════════════════════════════════════════════════

stage_match AS (
  SELECT
    wt.turn_id,
    rt.to_stage                AS real_to_stage,
    st.shadow_to_stage,
    CASE
      WHEN rt.to_stage IS NULL AND st.shadow_to_stage IS NULL THEN TRUE
      WHEN rt.to_stage IS NOT DISTINCT FROM st.shadow_to_stage THEN TRUE
      ELSE FALSE
    END AS matches
  FROM window_turns wt
  LEFT JOIN real_transitions  rt ON rt.turn_id = wt.turn_id
  LEFT JOIN shadow_transitions st ON st.turn_id = wt.turn_id
),

-- ═══════════════════════════════════════════════════════════════════════════
-- CRITERIO 2: equivalencia de acción de negocio (≥90%)
-- Equivalente = mismo set de slugs enviados (variante puede diferir)
-- Real:  lead_content_sent por turn_id
-- Shadow: comandos SendContent del JSONB
-- ═══════════════════════════════════════════════════════════════════════════

real_content_sent AS (
  SELECT
    lcs.turn_id,
    array_agg(DISTINCT lcs.slug_id ORDER BY lcs.slug_id) AS slugs
  FROM api.lead_content_sent lcs
  WHERE lcs.turn_id IN (SELECT turn_id FROM window_turns)
  GROUP BY lcs.turn_id
),

shadow_content_sent AS (
  SELECT
    wt.turn_id,
    array_agg(DISTINCT cmd->>'slug_id' ORDER BY cmd->>'slug_id') AS slugs
  FROM window_turns wt,
       jsonb_array_elements(wt.commands) AS cmd
  WHERE cmd->>'type' = 'SendContent'
  GROUP BY wt.turn_id
),

business_match AS (
  SELECT
    wt.turn_id,
    rcs.slugs AS real_slugs,
    scs.slugs AS shadow_slugs,
    CASE
      -- Ambos sin contenido enviado
      WHEN rcs.slugs IS NULL AND scs.slugs IS NULL THEN TRUE
      -- Mismo set de slugs exacto
      WHEN rcs.slugs IS NOT DISTINCT FROM scs.slugs THEN TRUE
      -- Al menos un slug en común (mismo contenido principal, variante distinta)
      WHEN rcs.slugs && scs.slugs THEN TRUE
      ELSE FALSE
    END AS matches
  FROM window_turns wt
  LEFT JOIN real_content_sent  rcs ON rcs.turn_id = wt.turn_id
  LEFT JOIN shadow_content_sent scs ON scs.turn_id = wt.turn_id
)

-- ═══════════════════════════════════════════════════════════════════════════
-- RESUMEN EJECUTIVO
-- ═══════════════════════════════════════════════════════════════════════════

SELECT '=== PARITY REPORT ADR-0024 ===' AS report, now()::text AS ts;

SELECT
  count(*)                                                                    AS total_turns,
  sum(CASE WHEN sm.matches THEN 1 ELSE 0 END)                                AS c1_stage_ok,
  round(100.0 * sum(CASE WHEN sm.matches THEN 1 ELSE 0 END)
        / nullif(count(*), 0), 1)                                            AS "c1_pct (req=100)",
  sum(CASE WHEN bm.matches THEN 1 ELSE 0 END)                                AS c2_biz_ok,
  round(100.0 * sum(CASE WHEN bm.matches THEN 1 ELSE 0 END)
        / nullif(count(*), 0), 1)                                            AS "c2_pct (req>=90)",
  (SELECT count(*) FROM api.agent_shadow_runs
   WHERE error IS NOT NULL
     AND created_at >= now() - interval '3 days')                            AS "c4_errors_3d (req=0)"
FROM stage_match sm
JOIN business_match bm USING (turn_id);

-- ─── Criterio 1: divergencias de etapa ────────────────────────────────────

SELECT '--- C1: divergencias de etapa ---' AS section;

SELECT
  sm.turn_id,
  wt.subscriber_id,
  wt.started_at,
  coalesce(sm.real_to_stage,   '(sin transición)') AS real_stage,
  coalesce(sm.shadow_to_stage, '(sin transición)') AS shadow_stage
FROM stage_match sm
JOIN window_turns wt USING (turn_id)
WHERE sm.matches = FALSE
ORDER BY wt.started_at DESC
LIMIT 50;

-- ─── Criterio 2: divergencias de acción de negocio ────────────────────────

SELECT '--- C2: divergencias de acción de negocio ---' AS section;

SELECT
  bm.turn_id,
  wt.subscriber_id,
  wt.started_at,
  bm.real_slugs,
  bm.shadow_slugs
FROM business_match bm
JOIN window_turns wt USING (turn_id)
WHERE bm.matches = FALSE
ORDER BY wt.started_at DESC
LIMIT 50;

-- ─── Criterio 3: muestra para revisión humana (máx 30 divergentes) ────────

SELECT '--- C3: muestra revisión humana (texto libre) ---' AS section;

SELECT
  wt.turn_id,
  wt.subscriber_id,
  wt.started_at,
  wt.real_response                        AS n8n_response_text,
  wt.response_texts                       AS shadow_response_texts,
  coalesce(sm.real_to_stage, '-')         AS real_stage_change,
  coalesce(sm.shadow_to_stage, '-')       AS shadow_stage_change
FROM window_turns wt
JOIN stage_match sm USING (turn_id)
JOIN business_match bm USING (turn_id)
WHERE sm.matches = FALSE OR bm.matches = FALSE
ORDER BY wt.started_at DESC
LIMIT 30;

-- ─── Criterio 4: errores de plataforma recientes ──────────────────────────

SELECT '--- C4: errores de plataforma (últimos 3 días) ---' AS section;

SELECT
  asr.turn_id,
  asr.tenant_id,
  asr.error,
  asr.created_at
FROM api.agent_shadow_runs asr
WHERE asr.error IS NOT NULL
  AND asr.created_at >= now() - interval '3 days'
ORDER BY asr.created_at DESC;

-- ─── Evaluación final ─────────────────────────────────────────────────────

SELECT '--- EVALUACIÓN FINAL ---' AS section;

WITH summary AS (
  SELECT
    count(*)                                                             AS total,
    round(100.0 * sum(CASE WHEN sm.matches THEN 1 ELSE 0 END)
          / nullif(count(*), 0), 1)                                     AS c1_pct,
    round(100.0 * sum(CASE WHEN bm.matches THEN 1 ELSE 0 END)
          / nullif(count(*), 0), 1)                                     AS c2_pct,
    (SELECT count(*) FROM api.agent_shadow_runs
     WHERE error IS NOT NULL
       AND created_at >= now() - interval '3 days')                     AS errors_3d
  FROM stage_match sm
  JOIN business_match bm USING (turn_id)
)
SELECT
  total                                                                  AS turnos_analizados,
  c1_pct || '%'   AS "C1 transiciones",
  CASE WHEN c1_pct = 100 THEN 'OK' ELSE 'FALLA' END                    AS "C1",
  c2_pct || '%'   AS "C2 acciones",
  CASE WHEN c2_pct >= 90  THEN 'OK' ELSE 'FALLA' END                   AS "C2",
  errors_3d       AS "C4 errores",
  CASE WHEN errors_3d = 0 THEN 'OK' ELSE 'FALLA' END                   AS "C4",
  CASE
    WHEN c1_pct = 100 AND c2_pct >= 90 AND errors_3d = 0
      THEN 'LISTO para cutover (pendiente revisión humana C3)'
    ELSE 'NO listo — resolver divergencias antes del cutover'
  END AS veredicto
FROM summary;
