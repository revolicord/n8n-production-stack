# Nodo 09: Build SQL

**Tipo:** Code (`n8n-nodes-base.code`)  
**ID:** `6ab1ef17-e65c-4c01-9dfb-22b68546ac5b`  
**Posición en cadena:** después de `After Send`, antes de `Insert followup log`  
**Propósito:** Construir las tres queries SQL necesarias post-envío: insertar en el log de follow-ups, insertar en la memoria del agente, y actualizar el cron (avanzar secuencia o archivar).

---

## Código

```js
const pd = $('Loop Over Leads').first().json;
const esc = s => String(s || '').replace(/'/g, "''");

const stageId    = pd.current_stage_id ? "'" + pd.current_stage_id + "'" : 'NULL';
const templateId = pd.template_id      ? "'" + pd.template_id + "'"      : 'NULL';
const delayHours = pd.next_delay_hours;

// 1. Log de envío
const logSql =
  "INSERT INTO api.lead_followup_log " +
  "(tenant_id, subscriber_id, conversation_id, stage_id, template_id, " +
  "sequence_number, text_sent, status) VALUES (" +
  "'" + pd.tenant_id       + "'," +
  "'" + pd.subscriber_id   + "'," +
  "'" + pd.conversation_id + "'," +
  stageId + "," + templateId + "," +
  pd.next_sequence_number  + "," +
  "'" + esc(pd.textSent)   + "'," +
  "'sent')";

// 2. Memoria del agente
const histSql =
  "INSERT INTO n8n_chat_histories (session_id, message) VALUES (" +
  "'" + pd.manychat_subscriber_id + "', " +
  "jsonb_build_object('type','ai','data',jsonb_build_object(" +
  "'content','" + esc(pd.chatMemoryText) + "'," +
  "'additional_kwargs','{}'))::jsonb)";

// 3. Avanzar secuencia o archivar
const updateSql = delayHours
  ? "UPDATE api.lead_crons SET " +
    "next_sequence_number = next_sequence_number + 1, " +
    "next_followup_at = NOW() + INTERVAL '" + parseInt(delayHours) + " hours', " +
    "is_active = TRUE, archived_at = NULL, archive_reason = NULL, " +
    "updated_at = NOW() WHERE id = '" + pd.cron_id + "'"
  : "UPDATE api.lead_crons SET " +
    "is_active = FALSE, archived_at = NOW(), " +
    "archive_reason = 'max_followups', updated_at = NOW() " +
    "WHERE id = '" + pd.cron_id + "'";

return [{ json: { logSql, histSql, updateSql } }];
```

## Campos de salida

| Campo | Descripción |
|-------|-------------|
| `logSql` | INSERT en `api.lead_followup_log` |
| `histSql` | INSERT en `n8n_chat_histories` |
| `updateSql` | UPDATE en `api.lead_crons` (avanzar o archivar) |

## Lógica de `updateSql`

- `delayHours` **distinto de NULL** → hay template siguiente → se incrementa `next_sequence_number`, se calcula `next_followup_at = NOW() + N horas`, cron permanece activo.
- `delayHours` **NULL** → no hay template siguiente → `is_active = FALSE`, `archive_reason = 'max_followups'`.

## Por qué se accede a `$('Loop Over Leads').first().json`

`After Send` recibe la respuesta HTTP de ManyChat, no los campos del lead. Para recuperar los datos originales se hace referencia explícita al nodo `Loop Over Leads` (el ítem que se está procesando en la iteración actual).

## Notas

- La concatenación de strings con valores de DB (en lugar de prepared statements) es aceptable aquí porque los UUIDs y enteros vienen de Postgres — no de input de usuario. La función `esc()` protege solo el texto libre (`textSent`, `chatMemoryText`).
- Los tres SQL se ejecutan en nodos separados (no en una transacción). Si `Insert followup log` pasa pero `Update lead_crons` falla, el lead se reintentará y generará un segundo log entry con el mismo `sequence_number`. Agregar `ON CONFLICT DO NOTHING` en `lead_followup_log` si se quiere idempotencia estricta.
