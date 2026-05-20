# Nodo: lead_content_sent (INSERT)

**Tipo:** Postgres  
**Nombre en UI:** `lead_content_sent`  
**Posición en cadena:** Después del nodo `If` (rama false), antes de `Upsert Lead Cron`  
**Propósito:** Registrar en `api.lead_content_sent` que se envió un flow multimedia al lead en este turno. Esto alimenta el historial que `Get Content History` leerá en el próximo turno.

---

## Query SQL (exacta del workflow)

```sql
INSERT INTO api.lead_content_sent (
  tenant_id, subscriber_id, conversation_id, stage_slug,
  slug_id, flow_ns, turn_id
) VALUES (
  $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::uuid
)
```

## Parámetros (queryReplacement — comma-separated)

```
={{ $json.insert_content_sent.tenant_id }},{{ $json.insert_content_sent.subscriber_id }},{{ $json.insert_content_sent.conversation_id }},{{ $json.insert_content_sent.stage_slug }},{{ $json.insert_content_sent.slug_id }},{{ $json.insert_content_sent.flow_ns }},{{ $json.insert_content_sent.turn_id }}
```

| $N | Campo | Fuente |
|----|-------|--------|
| $1 | `tenant_id` UUID | `insert_content_sent.tenant_id` (de Router) |
| $2 | `subscriber_id` UUID | `insert_content_sent.subscriber_id` (de Router) |
| $3 | `conversation_id` UUID | `insert_content_sent.conversation_id` (de Router) |
| $4 | `stage_slug` string | `insert_content_sent.stage_slug` (etapa actual) |
| $5 | `slug_id` string | `insert_content_sent.slug_id` (ej. `QC_A_VIDEO_HOOK`) |
| $6 | `flow_ns` string | `insert_content_sent.flow_ns` (ej. `content20260511...`) |
| $7 | `turn_id` UUID | `insert_content_sent.turn_id` |

> **⚠️ Bug en el JSON vivo:** el `queryReplacement` está en formato roto con `=$1 = value $2 = value ...` para los 7 parámetros. El formato correcto es comma-separated como se muestra arriba. Corregir en la UI de n8n.

## Fuente del objeto `insert_content_sent`

El Router produce este objeto solo cuando `send_content` tuvo status `'sent'`:

```javascript
insert_content_sent: results.send_content && results.send_content.status === 'sent'
  ? results.send_content.insert_payload
  : null
```

El `insert_payload` se construye en el Router:

```javascript
insert_payload: {
  tenant_id:       ctx.tenantDbId,
  subscriber_id:   ctx.subscriberDbId,
  conversation_id: ctx.conversationId,
  stage_slug:      ctx.currentStage,
  slug_id:         slugId,
  flow_ns:         flowNs,
  turn_id:         ctx.turnId
}
```

## Conexiones

- **Input:** nodo `If` (rama 1 — false)
- **Output:** `Upsert Lead Cron`

## Schema de la tabla

```sql
CREATE TABLE api.lead_content_sent (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  subscriber_id   uuid NOT NULL,
  conversation_id uuid NOT NULL,
  stage_slug      text NOT NULL,
  slug_id         text NOT NULL,
  flow_ns         text NOT NULL,
  turn_id         uuid NOT NULL,
  sent_at         timestamptz NOT NULL DEFAULT NOW(),
  lead_responded  boolean NOT NULL DEFAULT FALSE,
  responded_at    timestamptz
);
```

`lead_responded` arranca en `FALSE`. Se actualiza a `TRUE` por `Execute a SQL query1` al inicio del siguiente turno.
