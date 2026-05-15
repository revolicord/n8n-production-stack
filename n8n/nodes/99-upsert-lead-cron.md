# Nodo: Upsert Lead Cron

**Tipo:** Postgres  
**Posición en cadena:** 99 — después de `enviar texto` (post-respuesta del agente)  
**ADR:** ADR-0011  
**Propósito:** Programar el próximo follow-up del lead (o resetear la secuencia si respondió). También marca follow-ups previos como `responded` en `lead_followup_log`.

---

## Query 1: UPSERT en lead_crons

Lee `current_stage_id` directamente desde `lead_stages` para capturar cambios de etapa que el agente haya hecho durante el turno.

```sql
INSERT INTO api.lead_crons (
  tenant_id, subscriber_id, conversation_id, current_stage_id,
  next_followup_at, next_sequence_number, is_active
)
SELECT
  $1, $2, $3,
  ls.current_stage_id,
  NOW() + ft.delay_hours * INTERVAL '1 hour',
  1,
  TRUE
FROM api.lead_stages ls
LEFT JOIN api.followup_templates ft
  ON ft.stage_id        = ls.current_stage_id
  AND ft.sequence_number = 1
  AND ft.is_active       = TRUE
WHERE ls.subscriber_id = $2
  AND ls.tenant_id     = $1
LIMIT 1
ON CONFLICT (tenant_id, subscriber_id, conversation_id) DO UPDATE SET
  current_stage_id     = EXCLUDED.current_stage_id,
  next_followup_at     = EXCLUDED.next_followup_at,
  next_sequence_number = 1,
  is_active            = TRUE,
  updated_at           = NOW();
```

**Parámetros:**
- `$1` = `tenant_id` (UUID)
- `$2` = `subscriber_id` (UUID interno del subscriber)
- `$3` = `conversation_id` (UUID de la conversación)

> **Nota Path B**: La query lee `lead_stages.current_stage_id` en vez de `subscribers.current_stage_id` (adaptación al schema real del proyecto).

---

## Query 2: Marcar follow-ups previos como respondidos

Si el lead responde después de recibir seguimientos automáticos, marcarlos como `responded`:

```sql
UPDATE api.lead_followup_log SET
  status       = 'responded',
  responded_at = NOW()
WHERE subscriber_id   = $1
  AND conversation_id = $2
  AND status          = 'sent';
```

**Parámetros:**
- `$1` = `subscriber_id` (UUID interno)
- `$2` = `conversation_id` (UUID)

---

## Cuándo ejecutar

| Evento | Acción |
|---|---|
| Lead envía mensaje → agente responde | Ejecutar ambas queries. Reset completo (secuencia #1, etapa actual). |
| Agente usa `archive_conversation` | No ejecutar. El endpoint de la tool actualiza `lead_crons` directamente. |

## Notas

- Si no existe template de `sequence_number = 1` para la etapa actual, `next_followup_at` queda NULL — el runner no disparará para este lead.
- La etapa `D` (Cliente, `max_followups = 0`) no tiene templates → `next_followup_at = NULL` siempre.
