# Nodo: Get Due Leads

**Tipo:** Postgres — Execute Query  
**ID:** `272716da-6682-416e-9c8f-81318e4554d8`  
**Posición en flujo:** 2 de 17 (después del trigger, antes de Prepare Data)

---

## Propósito

Obtiene todos los leads cuyo próximo follow-up está vencido (`next_followup_at <= NOW()`), junto con la plantilla correspondiente al `next_sequence_number` actual y la plantilla siguiente (para calcular el delay del próximo ciclo).

---

## SQL

```sql
SELECT
    lc.id                              AS cron_id,
    lc.tenant_id,
    lc.subscriber_id,
    lc.conversation_id,
    lc.current_stage_id,
    lc.next_sequence_number,
    s.manychat_subscriber_id,
    s.display_name,
    t.config->>'manychat_api_key'      AS mc_api_key,
    fs.max_followups,
    fs.slug                            AS stage_slug,
    ft.id                              AS template_id,
    ft.type                            AS followup_type,
    ft.text_template,
    ft.flow_ns                         AS followup_flow_ns,
    ft.description                     AS followup_description,
    ft_next.delay_minutes              AS next_delay_minutes,
    msgs.content_text,
    msgs.image_context,
    COALESCE(
      (SELECT json_agg(
        json_build_object(
          'message_type', fm.message_type,
          'text_content',  fm.text_content,
          'media_url',     fm.media_url,
          'sort_order',    fm.sort_order
        ) ORDER BY fm.sort_order ASC)
       FROM api.followup_messages fm
       WHERE fm.template_id = ft.id
      ), '[]'::json
    ) AS followup_messages
  FROM api.lead_crons lc
  JOIN api.subscribers    s   ON s.id = lc.subscriber_id
  JOIN api.tenants        t   ON t.id = lc.tenant_id
  JOIN api.funnel_stages  fs  ON fs.id = lc.current_stage_id
  LEFT JOIN api.followup_templates ft ON
    ft.stage_id        = lc.current_stage_id
    AND ft.sequence_number = lc.next_sequence_number
    AND ft.is_active   = TRUE
  LEFT JOIN api.followup_templates ft_next ON
    ft_next.stage_id       = lc.current_stage_id
    AND ft_next.sequence_number = lc.next_sequence_number + 1
    AND ft_next.is_active  = TRUE
  LEFT JOIN LATERAL (
    SELECT
      max(CASE WHEN fm.message_type = 'text'  THEN fm.text_content     END) AS content_text,
      max(CASE WHEN fm.message_type = 'image' THEN fm.ai_image_context END) AS image_context
    FROM api.followup_messages fm
    WHERE fm.template_id = ft.id
  ) msgs ON TRUE
  WHERE lc.is_active        = TRUE
    AND lc.next_followup_at IS NOT NULL
    AND lc.next_followup_at <= NOW()
  ORDER BY lc.next_followup_at ASC
  LIMIT 50
```

> **Nota:** El `RETURNING *` al final del query en el JSON es inválido para un SELECT. En la UI de n8n se puede ignorar; no genera error porque n8n no lo ejecuta literalmente. Eliminar si causa conflicto.

---

## Campos de salida

| Campo | Fuente | Descripción |
|-------|--------|-------------|
| `cron_id` | `lead_crons.id` | PK del cron, usado para UPDATE/Archive |
| `tenant_id` | `lead_crons.tenant_id` | UUID del tenant |
| `subscriber_id` | `lead_crons.subscriber_id` | UUID del subscriber |
| `conversation_id` | `lead_crons.conversation_id` | UUID de la conversación |
| `current_stage_id` | `lead_crons.current_stage_id` | UUID de la etapa actual |
| `next_sequence_number` | `lead_crons.next_sequence_number` | Número de secuencia a enviar |
| `manychat_subscriber_id` | `subscribers.manychat_subscriber_id` | ID numérico de ManyChat |
| `display_name` | `subscribers.display_name` | Nombre para interpolar en templates |
| `mc_api_key` | `tenants.config` | API key de ManyChat del tenant |
| `max_followups` | `funnel_stages.max_followups` | Máximo de follow-ups permitidos |
| `stage_slug` | `funnel_stages.slug` | Slug de la etapa (ej. "A") |
| `template_id` | `followup_templates.id` | UUID del template actual (NULL si no existe) |
| `followup_type` | `followup_templates.type` | `text`, `flow`, o `content` |
| `text_template` | `followup_templates.text_template` | Texto con `{{name}}` para interpolar |
| `followup_flow_ns` | `followup_templates.flow_ns` | Namespace del flow en ManyChat |
| `followup_description` | `followup_templates.description` | Descripción legible del template |
| `next_delay_minutes` | `ft_next.delay_minutes` | Delay en minutos al siguiente follow-up |
| `content_text` | `followup_messages` (LATERAL) | Texto del mensaje tipo `content` |
| `image_context` | `followup_messages` (LATERAL) | Contexto AI de la imagen enviada |
| `followup_messages` | `followup_messages` (json_agg) | Array JSON ordenado de `{message_type, text_content, media_url, sort_order}` para templates tipo `content` |

---

## Diferencias v1 → v2

- `delay_hours` renombrado a `delay_minutes` (tabla `followup_templates` migrada)
- Nuevo campo `max_followups` desde `funnel_stages`
- Nuevo LATERAL join a `followup_messages` para `content_text` e `image_context`
- Nuevos campos en el SELECT: `fs.max_followups`, `msgs.content_text`, `msgs.image_context`

---

## Tablas involucradas

- `api.lead_crons` — fuente principal
- `api.subscribers` — datos del suscriptor
- `api.tenants` — credenciales por tenant
- `api.funnel_stages` — configuración de etapa
- `api.followup_templates` — plantillas (actual y siguiente)
- `api.followup_messages` — contenido multimedia de templates tipo `content`
