# Nodo: Get Stage Config

**Tipo:** Postgres  
**Posición en cadena:** 0 — antes de `Build Context`  
**ADR:** ADR-0010  
**Propósito:** Leer la configuración de la etapa actual desde `funnel_stages` + `stage_flows`. Reemplaza el `FLOW_MAP` hardcodeado de `Build Context`.

---

## Query SQL

```sql
SELECT
  fs.id           AS stage_id,
  fs.slug,
  fs.display_name,
  fs.description,
  fs.max_followups,
  COALESCE(
    json_agg(
      json_build_object(
        'flow_ns',             sf.flow_ns,
        'human_name',          sf.human_name,
        'media_type',          sf.media_type,
        'content_description', sf.content_description,
        'usage_condition',     COALESCE(sf.usage_condition, sf.description),
        'weight',              sf.weight,
        'variant_group',       sf.variant_group
      )
    ) FILTER (WHERE sf.id IS NOT NULL AND sf.is_active = TRUE AND sf.flow_ns NOT LIKE 'PENDIENTE%'),
    '[]'::json
  ) AS flows
FROM api.funnel_stages fs
LEFT JOIN api.stage_flows sf ON sf.stage_id = fs.id AND sf.is_active = TRUE
WHERE fs.tenant_id = '{{ $json.body.tenant.id }}'
  AND fs.slug      = '{{ $json.body.subscriber.lead_stage }}'
  AND fs.is_active = TRUE
GROUP BY fs.id;
```

> El filtro `sf.flow_ns NOT LIKE 'PENDIENTE%'` excluye flows con ns pendiente de configurar.
> Así el agente nunca recibe un flow roto aunque esté marcado como activo en DB.

## Parámetros

| Variable n8n | Fuente |
|---|---|
| `tenant.id` | `body.tenant.id` del payload del webhook |
| `subscriber.lead_stage` | `body.subscriber.lead_stage` del payload del webhook |

## Salida esperada

```json
{
  "stage_id": "uuid",
  "slug": "A",
  "display_name": "Enganche",
  "description": "Video de enganche 25s — primer contacto, pedir pulgar arriba",
  "max_followups": 3,
  "flows": [
    { "flow_ns": "content...", "description": "Video hook 25s", "weight": 1 }
  ]
}
```

## Manejo de error

Si la query no retorna filas (etapa no existe en DB):
- `Build Context` usa `flows = []` y `description = ''` como defaults.
- El agente continúa sin enviar flow multimedia.
- Registrar en logs: `[Get Stage Config] etapa desconocida: <slug>`.

## Notas

- Encadenar en paralelo con `Get Subscriber CRM Context` (ADR-0013) para minimizar latencia total.
- Si la etapa es `B`, `C` o `D`, `flows` retorna `[]` (no hay multimedia) — comportamiento esperado.
