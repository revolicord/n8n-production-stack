# Nodo: Get Subscriber CRM Context

**Tipo:** Postgres  
**Posición en cadena:** 0b — en paralelo con `Get Stage Config`, antes de `Build Context`  
**ADR:** ADR-0013  
**Propósito:** Leer el estado CRM del lead (seguimientos enviados, historial, etapa) desde `lead_crons` + `lead_followup_log`. Provee el bloque cuantificado que complementa la memoria conversacional.

---

## Query SQL

```sql
SELECT
  lc.next_sequence_number - 1   AS followups_sent,
  lc.updated_at                 AS last_activity,
  lc.next_followup_at,
  fs.display_name               AS stage_name,
  fs.slug                       AS stage_slug,
  fs.description                AS stage_objective,
  fs.max_followups,
  COALESCE(
    json_agg(
      json_build_object(
        'seq',          lfl.sequence_number,
        'sent_at',      lfl.sent_at,
        'status',       lfl.status,
        'responded_at', lfl.responded_at,
        'text_sent',    lfl.text_sent
      ) ORDER BY lfl.sequence_number
    ) FILTER (WHERE lfl.id IS NOT NULL),
    '[]'::json
  ) AS followup_history
FROM api.lead_crons lc
JOIN api.funnel_stages fs ON fs.id = lc.current_stage_id
LEFT JOIN api.lead_followup_log lfl
  ON lfl.subscriber_id   = lc.subscriber_id
  AND lfl.conversation_id = lc.conversation_id
WHERE lc.subscriber_id   = '{{ $json.body.subscriber.id }}'
  AND lc.conversation_id = '{{ $json.body.conversation.id }}'
GROUP BY lc.id, fs.display_name, fs.slug, fs.description, fs.max_followups;
```

## Parámetros

| Variable n8n | Fuente |
|---|---|
| `subscriber.id` | UUID interno del subscriber en `body.subscriber.id` |
| `conversation.id` | UUID de la conversación en `body.conversation.id` |

## Salida esperada (lead con 2 seguimientos sin respuesta)

```json
{
  "followups_sent": 2,
  "last_activity": "2026-05-13T10:00:00Z",
  "next_followup_at": "2026-05-15T10:00:00Z",
  "stage_name": "Enganche",
  "stage_slug": "A",
  "stage_objective": "Video de enganche 25s — primer contacto, pedir pulgar arriba",
  "max_followups": 3,
  "followup_history": [
    { "seq": 1, "sent_at": "...", "status": "sent", "responded_at": null, "text_sent": "[SEGUIMIENTO AUTOMÁTICO #1] ..." },
    { "seq": 2, "sent_at": "...", "status": "sent", "responded_at": null, "text_sent": "[SEGUIMIENTO AUTOMÁTICO #2] ..." }
  ]
}
```

## Salida cuando no hay fila en lead_crons (primera vez)

La query no retorna filas. `Build Context` maneja con `?? {}` y defaults a cero.

## Notas

- Encadenar en paralelo con `Get Stage Config` para minimizar latencia.
- Si el lead acaba de responder tras un silencio, `Build Context` debe marcar los follow-ups como `responded` en `lead_followup_log` (ver nodo `99-upsert-lead-cron.md`).
