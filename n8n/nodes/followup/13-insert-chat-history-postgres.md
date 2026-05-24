# Nodo: Insert chat history1

**Tipo:** Postgres — Execute Query  
**Posición en flujo:** después de Insert n8n_chat_histories (Code) → Update lead_crons

---

## Propósito

Inserta el registro de memoria del follow-up en `n8n_chat_histories` como un mensaje de tipo `ai`. Esto permite que el agente n8n recuerde qué follow-ups automáticos se enviaron cuando el suscriptor responde.

---

## SQL

```sql
INSERT INTO n8n_chat_histories (session_id, message)
VALUES (
  $1,
  jsonb_build_object(
    'type', 'ai',
    'data', jsonb_build_object(
      'content',           $2,
      'additional_kwargs', '{}'::jsonb
    )
  )
);
```

## Query Replacement

```
={{ $json.manychat_subscriber_id }}, {{ $json.contenidoMemoria }}
```

---

## Parámetros

| Param | Expresión | Valor |
|-------|-----------|-------|
| `$1` | `manychat_subscriber_id` | ID numérico del suscriptor (session_id del chat) |
| `$2` | `contenidoMemoria` | Texto preparado por el nodo Code anterior |

---

## Registro insertado (ejemplo)

```json
{
  "session_id": "1724803790",
  "message": {
    "type": "ai",
    "data": {
      "content": "[SEGUIMIENTO AUTOMÁTICO #1] Hola Juan, ¿cómo estás?",
      "additional_kwargs": {}
    }
  }
}
```

---

## Diferencias v1 → v2

| Aspecto | v1 | v2 |
|---------|----|----|
| Nombre | "Insert chat history" | "Insert chat history1" |
| SQL | `$json.histSql` (string embebido de Build SQL) | SQL parametrizado con `$1`, `$2` |
| Datos | chatMemoryText genérico | contenidoMemoria diferenciado por tipo |
| Seguridad | SQL injection posible via string concat | Parametrizado — seguro |

---

## Conexión posterior

→ **Update lead_crons**
