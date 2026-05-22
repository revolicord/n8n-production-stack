# Nodo: Get Stage Config

**Tipo:** Postgres  
**Versión:** v2  
**Posición en cadena:** 0 — en paralelo con `Get Subscriber CRM Context`  
**ADR:** ADR-0010  
**Propósito:** Leer la configuración de la etapa actual del lead desde `funnel_stages` + `stage_flows` + `stage_transitions_map`. Incluye lista de transiciones válidas con su `when_to_use`, todos los flows disponibles con sus metadatos, y (v2) el catálogo completo de flows del tenant agrupado por stage_slug para que el Router resuelva slugs cross-stage.

---

## Query SQL (exacta del workflow)

```sql
-- ============================================================================
-- Get Stage Config — v2
-- ----------------------------------------------------------------------------
-- Cambios respecto a v1:
--   - Añade columna `all_stages_flows`: catálogo completo de flows del tenant
--     agrupados por stage_slug. Lo usa el Router para resolver slug_id de
--     destinos de macros (que viven en stages distintos al actual).
--   - El resto de columnas (flows del stage actual, valid_transitions, goal,
--     etc.) queda igual — Build Context las sigue leyendo como antes.
-- ============================================================================

SELECT
  fs.id           AS stage_id,
  fs.slug,
  fs.display_name,
  fs.description,
  fs.goal,
  fs.max_followups,

  -- Valid transitions del stage actual (sin cambios)
  COALESCE(
    (
      SELECT json_agg(
        json_build_object(
          'slug',        stm.to_stage_slug,
          'when_to_use', stm.when_to_use
        ) ORDER BY stm.to_stage_slug
      )
      FROM api.stage_transitions_map stm
      WHERE stm.tenant_id = fs.tenant_id
        AND stm.from_stage_slug = fs.slug
        AND stm.is_active = TRUE
    ),
    '[]'::json
  ) AS valid_transitions,

  -- Flows del stage actual (sin cambios — sigue alimentando content_options del agente)
  COALESCE(
    json_agg(
      json_build_object(
        'flow_ns',             sf.flow_ns,
        'slug_id',             COALESCE(sf.slug_id, sf.human_name),
        'human_name',          sf.human_name,
        'media_type',          sf.media_type,
        'content_description', sf.content_description,
        'usage_condition',     COALESCE(sf.usage_condition, sf.description),
        'weight',              sf.weight,
        'variant_group',       sf.variant_group
      )
    ) FILTER (WHERE sf.id IS NOT NULL AND sf.is_active = TRUE AND sf.flow_ns NOT LIKE 'PENDIENTE%'),
    '[]'::json
  ) AS flows,

  -- NUEVO v2: catálogo completo de flows del tenant, agrupado por stage_slug.
  -- Estructura: { "<stage_slug>": [ { slug_id, flow_ns, weight, variant_group, ... }, ... ] }
  -- El Router lo usa para resolver slug_id cuando una macro envía contenido
  -- de un stage distinto al actual del lead.
  (
    SELECT json_object_agg(stage_slug, flows_arr)
    FROM (
      SELECT
        fs2.slug AS stage_slug,
        json_agg(
          json_build_object(
            'flow_ns',       sf2.flow_ns,
            'slug_id',       COALESCE(sf2.slug_id, sf2.human_name),
            'human_name',    sf2.human_name,
            'media_type',    sf2.media_type,
            'weight',        sf2.weight,
            'variant_group', sf2.variant_group
          )
        ) AS flows_arr
      FROM api.funnel_stages fs2
      JOIN api.stage_flows sf2
        ON sf2.stage_id = fs2.id
       AND sf2.is_active = TRUE
       AND sf2.flow_ns NOT LIKE 'PENDIENTE%'
      WHERE fs2.tenant_id = fs.tenant_id
        AND fs2.is_active = TRUE
      GROUP BY fs2.slug
    ) AS s
  ) AS all_stages_flows

FROM api.funnel_stages fs
LEFT JOIN api.stage_flows sf ON sf.stage_id = fs.id AND sf.is_active = TRUE
WHERE fs.tenant_id = $1::uuid
  AND fs.slug      = $2
  AND fs.is_active = TRUE
GROUP BY fs.id
```

## Parámetros (queryReplacement — comma-separated)

```
={{ $json.body.tenant.id }},{{ $json.body.subscriber.lead_stage || 'A' }}
```

| $N | Campo | Fuente |
|----|-------|--------|
| $1 | `tenant_id` UUID | `body.tenant.id` |
| $2 | `stage_slug` string | `body.subscriber.lead_stage` (fallback `'A'`) |

> **Nota:** el nodo Webhook es el primero en la cadena; `$json` en este nodo apunta al output del Webhook. No hace falta `$('Webhook').first()`.

## Salida esperada

```json
{
  "stage_id": "uuid",
  "slug": "A",
  "display_name": "Enganche",
  "description": "Video de enganche 25s — primer contacto",
  "goal": "Conseguir que el lead vea el video y reaccione con pulgar arriba",
  "max_followups": 3,
  "valid_transitions": [
    { "slug": "MS", "when_to_use": "El lead confirma que vio el video o reacciona positivamente" },
    { "slug": "disqualified", "when_to_use": "El lead declara explícitamente que no le interesa o no puede pagar" }
  ],
  "flows": [
    {
      "flow_ns": "content20260511153207_699341",
      "slug_id": "QC_A_VIDEO_HOOK",
      "human_name": "QC_A_VIDEO_HOOK",
      "media_type": "video",
      "content_description": "Video hook 25s — enganche inicial",
      "usage_condition": "Primer turno o cuando el lead saluda sin haber visto nada",
      "weight": 1,
      "variant_group": null
    }
  ],
  "all_stages_flows": {
    "A":  [ { "flow_ns": "content...", "slug_id": "QC_A_VIDEO_HOOK", "human_name": "QC_A_VIDEO_HOOK", "media_type": "video", "weight": 1, "variant_group": null } ],
    "MS": [ { "flow_ns": "content...", "slug_id": "QC_MS_AUDIO_se envia antes de la vsl", "human_name": "QC_MS_AUDIO_...", "media_type": "audio", "weight": 1, "variant_group": null },
            { "flow_ns": "content...", "slug_id": "QC_MS_VIDEO_vsl que demuestra resultados", "human_name": "QC_MS_VIDEO_...", "media_type": "video", "weight": 1, "variant_group": null } ]
  }
}
```

> `valid_transitions` es un array de objetos `{ slug, when_to_use }`. Build Context lo pasa directamente al LLM como guía de cuándo transicionar.

> `all_stages_flows` es un objeto `{ stage_slug: [flows] }` con el catálogo completo del tenant. Build Context lo lee como `stageFlowsBySlug` y el Router lo usa para resolver `slug_id → flow_ns` cuando una macro necesita enviar contenido de un stage distinto al actual (ej: `MS→B` manda audios que viven en MS, no en B).

## Salida cuando la etapa no existe en DB

La query no retorna filas. `Build Context` usa `stageConfig = {}` como fallback:
- `flows = []`, `goal = null`, `valid_transitions = []`
- El agente continúa sin flows ni transiciones disponibles.

## Notas

- El filtro `sf.flow_ns NOT LIKE 'PENDIENTE%'` excluye flows con ns aún no configurado.
- `slug_id` = `COALESCE(sf.slug_id, sf.human_name)` — si la columna `slug_id` está vacía, usa el nombre humano como identificador.
- Encadenar en paralelo con `Get Subscriber CRM Context` para minimizar latencia.
