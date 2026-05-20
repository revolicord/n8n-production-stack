# Nodo: Execute a SQL query1 (mark content responded)

**Tipo:** Postgres  
**Posición en cadena:** Entre `System Prompt` y `Build Context`  
**Nombre en UI:** `Execute a SQL query1`  
**Propósito:** Antes de que el AI analice el turno, marcar como `lead_responded = TRUE` todos los registros de `lead_content_sent` del subscriber en esta conversación que aún no tenían respuesta. Esto garantiza que cuando Build Context calcule `lead_responded_to_it`, use el estado actualizado: el lead acaba de mandar un mensaje, lo que implica que respondió a cualquier contenido pendiente.

---

## Query SQL (exacta del workflow)

```sql
UPDATE api.lead_content_sent
SET lead_responded = TRUE, responded_at = NOW()
WHERE subscriber_id = $1::uuid
  AND conversation_id = $2::uuid
  AND lead_responded = FALSE
```

## Parámetros (queryReplacement — comma-separated)

```
={{ $('Webhook').first().json.body.subscriber.id }},{{ $('Webhook').first().json.body.conversation.id }}
```

| $N | Campo | Fuente |
|----|-------|--------|
| $1 | `subscriber_id` UUID | `body.subscriber.id` |
| $2 | `conversation_id` UUID | `body.conversation.id` |

> **⚠️ Bug en el JSON vivo:** el `queryReplacement` está en formato roto `=$1 = {{ ... }} $2 = {{ ... }}`. El formato correcto es comma-separated como se muestra arriba. Corregir en la UI de n8n.

## Por qué ejecutar ANTES de Build Context

El flujo en cada turno es:
1. El lead manda un mensaje (nuevo turno).
2. Este UPDATE marca todo el contenido previo como respondido (el lead respondió implícitamente).
3. Build Context lee `Get Content History` → ve `ever_responded = true` para el contenido anterior.
4. El agente sabe que ese contenido está AGOTADO y no lo reenvía.

Si este UPDATE se ejecutara DESPUÉS del turno (o no existiera), Build Context vería el contenido con `lead_responded = false` y el agente podría reenviarlo innecesariamente.

## Conexiones

- **Input:** `System Prompt` (main)
- **Output:** `Build Context` (main)

El nodo no filtra rows actualizado — si el UPDATE no encuentra filas (no hay contenido pendiente), la ejecución continúa sin error.
