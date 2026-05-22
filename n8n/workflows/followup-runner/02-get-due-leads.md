# Nodo 02: Get Due Leads

**Tipo:** Postgres — Execute Query (`n8n-nodes-base.postgres`)  
**ID:** `e7cf67be-6489-4db8-ba3e-2ffa4c2f9b14`  
**Posición en cadena:** después de `Every 5 Minutes`, antes de `Prepare Data`  
**Propósito:** Obtener hasta 50 leads con follow-up vencido (`next_followup_at <= NOW()`), incluyendo los datos del template actual y del siguiente (para calcular el próximo delay).

---

## Query SQL

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
  fs.slug                            AS stage_slug,
  ft.id                              AS template_id,
  ft.type                            AS followup_type,
  ft.text_template,
  ft.flow_ns                         AS followup_flow_ns,
  ft.description                     AS followup_description,
  ft_next.delay_hours                AS next_delay_hours
FROM api.lead_crons lc
JOIN api.subscribers   s   ON s.id   = lc.subscriber_id
JOIN api.tenants       t   ON t.id   = lc.tenant_id
JOIN api.funnel_stages fs  ON fs.id  = lc.current_stage_id
LEFT JOIN api.followup_templates ft ON
  ft.stage_id        = lc.current_stage_id
  AND ft.sequence_number = lc.next_sequence_number
  AND ft.is_active   = TRUE
LEFT JOIN api.followup_templates ft_next ON
  ft_next.stage_id        = lc.current_stage_id
  AND ft_next.sequence_number = lc.next_sequence_number + 1
  AND ft_next.is_active   = TRUE
WHERE lc.is_active        = TRUE
  AND lc.next_followup_at IS NOT NULL
  AND lc.next_followup_at <= NOW()
ORDER BY lc.next_followup_at ASC
LIMIT 50
```

## Campos de salida por ítem

| Campo | Fuente | Uso posterior |
|-------|--------|---------------|
| `cron_id` | `lead_crons.id` | UPDATE/archivado final |
| `tenant_id` | `lead_crons.tenant_id` | INSERT en log |
| `subscriber_id` | `lead_crons.subscriber_id` | INSERT en log |
| `conversation_id` | `lead_crons.conversation_id` | INSERT en log |
| `current_stage_id` | `lead_crons.current_stage_id` | INSERT en log |
| `next_sequence_number` | `lead_crons.next_sequence_number` | INSERT log + Build SQL |
| `manychat_subscriber_id` | `subscribers.manychat_subscriber_id` | sendContent / sendFlow / chat history |
| `display_name` | `subscribers.display_name` | interpolación de `{{name}}` |
| `mc_api_key` | `tenants.config->>'manychat_api_key'` | header Authorization |
| `stage_slug` | `funnel_stages.slug` | contexto/log |
| `template_id` | `followup_templates.id` (seq actual) | guard `Has Template?` |
| `followup_type` | `followup_templates.type` | guard `Type is text?` |
| `text_template` | `followup_templates.text_template` | interpolación |
| `followup_flow_ns` | `followup_templates.flow_ns` | sendFlow |
| `followup_description` | `followup_templates.description` | chatMemoryText |
| `next_delay_hours` | `followup_templates(seq+1).delay_hours` | cálculo `next_followup_at` |

## Notas

- `ft` = template para el `next_sequence_number` actual → puede ser NULL (secuencia agotada).
- `ft_next` = template del siguiente número → `next_delay_hours` NULL significa que no hay más follow-ups.
- El `LIMIT 50` protege contra timeouts; ajustar junto con el intervalo del Schedule Trigger.
- `mc_api_key` se lee de `tenants.config` (JSONB) — multi-tenant desde el origen.
