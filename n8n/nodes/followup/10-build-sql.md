# Nodo: Build SQL

**Tipo:** Code (JavaScript)  
**Posición en flujo:** después de After Send → Insert followup log

---

## Propósito

Construye tres strings SQL que se ejecutarán en los nodos Postgres siguientes:
1. `logSql` — INSERT en `lead_followup_log`
2. `histSql` — INSERT en `n8n_chat_histories` (legado, ya no se usa — reemplazado por los nodos Insert n8n_chat_histories + Insert chat history1)
3. `updateSql` — UPDATE en `lead_crons` (avanza secuencia o archiva)

> **Nota:** En v2 el `histSql` que genera este nodo ya no se ejecuta. El insert en `n8n_chat_histories` fue extraído a un nodo Code dedicado ("Insert n8n_chat_histories") + un nodo Postgres separado. El campo `histSql` queda en el output pero no se referencia aguas abajo.

---

## Código

```javascript
const pd = $('Loop Over Leads').first().json;
const esc = s => String(s || '').replace(/'/g, "''");
const stageId = pd.current_stage_id ? "'" + pd.current_stage_id + "'" : 'NULL';
const templateId = pd.template_id ? "'" + pd.template_id + "'" : 'NULL';
const delayMinutes = pd.next_delay_minutes;

const logSql = "INSERT INTO api.lead_followup_log (tenant_id, subscriber_id, conversation_id, stage_id, template_id, sequence_number, text_sent, status) VALUES ('" + pd.tenant_id + "','" + pd.subscriber_id + "','" + pd.conversation_id + "'," + stageId + "," + templateId + "," + pd.next_sequence_number + ",'" + esc(pd.textSent) + "','sent')";

const histSql = "INSERT INTO n8n_chat_histories (session_id, message) VALUES ('" + pd.manychat_subscriber_id + "', jsonb_build_object('type','ai','data',jsonb_build_object('content','" + esc(pd.chatMemoryText) + "','additional_kwargs','{}'))::jsonb)";

const updateSql = delayMinutes
  ? "UPDATE api.lead_crons SET next_sequence_number = next_sequence_number + 1, next_followup_at = NOW() + INTERVAL '" + parseInt(delayMinutes) + " minutes', is_active = TRUE, archived_at = NULL, archive_reason = NULL, updated_at = NOW() WHERE id = '" + pd.cron_id + "'"
  : "UPDATE api.lead_crons SET is_active = FALSE, archived_at = NOW(), archive_reason = 'max_followups', updated_at = NOW() WHERE id = '" + pd.cron_id + "'";

return [{ json: { logSql, histSql, updateSql } }];
```

---

## Diferencias v1 → v2

| Aspecto | v1 | v2 |
|---------|----|----|
| Variable delay | `delayHours` → INTERVAL hours | `delayMinutes` → INTERVAL minutes |
| `histSql` | Se ejecutaba en "Insert chat history" | Generado pero ignorado (reemplazado por nodos dedicados) |

---

## Campos de entrada (desde Loop Over Leads)

| Campo | Uso |
|-------|-----|
| `tenant_id` | logSql |
| `subscriber_id` | logSql |
| `conversation_id` | logSql |
| `current_stage_id` | logSql (stageId) |
| `template_id` | logSql (templateId) |
| `next_sequence_number` | logSql |
| `textSent` | logSql (escaped) |
| `manychat_subscriber_id` | histSql (legado) |
| `chatMemoryText` | histSql (legado) |
| `next_delay_minutes` | updateSql |
| `cron_id` | updateSql |

---

## Campos de salida

| Campo | Descripción |
|-------|-------------|
| `logSql` | INSERT string para `lead_followup_log` |
| `histSql` | INSERT string legado (no usado en v2) |
| `updateSql` | UPDATE string para `lead_crons` |
