# Nodo: Insert followup log

**Tipo:** Postgres — Execute Query  
**Posición en flujo:** después de Build SQL → Insert n8n_chat_histories

---

## Propósito

Registra el follow-up enviado en `api.lead_followup_log`. Es el log de auditoría de todos los follow-ups disparados.

---

## Configuración

```json
{
  "operation": "executeQuery",
  "query": "{{ $json.logSql }}",
  "options": {}
}
```

El SQL se pasa como string dinámico generado por **Build SQL**.

---

## SQL ejecutado (ejemplo)

```sql
INSERT INTO api.lead_followup_log (
  tenant_id, subscriber_id, conversation_id,
  stage_id, template_id, sequence_number,
  text_sent, status
) VALUES (
  'uuid-tenant', 'uuid-subscriber', 'uuid-conv',
  'uuid-stage', 'uuid-template', 1,
  'Hola Juan, ¿cómo estás?', 'sent'
)
```

---

## Tabla destino: `api.lead_followup_log`

| Columna | Valor |
|---------|-------|
| `tenant_id` | UUID del tenant |
| `subscriber_id` | UUID del subscriber |
| `conversation_id` | UUID de la conversación |
| `stage_id` | UUID de la etapa (o NULL) |
| `template_id` | UUID del template (o NULL) |
| `sequence_number` | Número de secuencia enviada |
| `text_sent` | Texto enviado (escaped) |
| `status` | `'sent'` |
