# Nodo: Update lead_crons

**Tipo:** Postgres — Execute Query  
**Posición en flujo:** último nodo antes de volver a Loop Over Leads

---

## Propósito

Actualiza el cron del lead después de enviar el follow-up. Hay dos casos:
- **Hay siguiente template** (`next_delay_minutes` no es null): avanza `next_sequence_number` y programa el próximo follow-up
- **No hay siguiente template** (`next_delay_minutes` es null): archiva el cron con razón `max_followups`

---

## Configuración

```json
{
  "operation": "executeQuery",
  "query": "{{ $('Insert n8n_chat_histories').item.json.updateSql }}",
  "options": {}
}
```

El SQL se referencia desde el nodo **Insert n8n_chat_histories** (Code) porque el nodo inmediato anterior (`Insert chat history1`, Postgres) no propaga `updateSql` en su salida.

---

## SQL ejecutado (caso: hay siguiente)

```sql
UPDATE api.lead_crons
SET
  next_sequence_number = next_sequence_number + 1,
  next_followup_at     = NOW() + INTERVAL '60 minutes',
  is_active            = TRUE,
  archived_at          = NULL,
  archive_reason       = NULL,
  updated_at           = NOW()
WHERE id = 'uuid-cron'
```

## SQL ejecutado (caso: último follow-up)

```sql
UPDATE api.lead_crons
SET
  is_active      = FALSE,
  archived_at    = NOW(),
  archive_reason = 'max_followups',
  updated_at     = NOW()
WHERE id = 'uuid-cron'
```

---

## Diferencias v1 → v2

| Aspecto | v1 | v2 |
|---------|----|----|
| Unidad de delay | `INTERVAL '... hours'` | `INTERVAL '... minutes'` |
| Variable fuente | `delayHours` | `delayMinutes` |

---

## Conexión posterior

→ **Loop Over Leads (input 0)** — regresa al loop para procesar el siguiente lead del batch.
