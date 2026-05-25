# Nodo: Get Content History

**Tipo:** Postgres  
**ID:** `c5fec6d0-cc3b-475e-b366-9bd9cff94907`  
**Posición en cadena:** 0d — después de `Get Subscriber CRM Context`, antes de `Combine Contexts`  
**Propósito:** Leer el historial de contenido ya enviado al lead en la etapa actual. Permite que Build Context enriquezca cada `content_option` con `last_sent`, `lead_responded_to_it` y `times_sent`, para que el agente evite reenviar contenido agotado.

---

## Query SQL (exacta del workflow)

```sql
SELECT
  slug_id,
  MAX(sent_at) AS last_sent_at,
  BOOL_OR(lead_responded) AS ever_responded,
  COUNT(*) AS times_sent
FROM api.lead_content_sent
WHERE subscriber_id   = $1::uuid
  AND conversation_id = $2::uuid
  AND stage_slug      = $3
GROUP BY slug_id
ORDER BY last_sent_at DESC
```

## Parámetros (queryReplacement — comma-separated)

```
={{ $('Webhook').first().json.body.subscriber.id }},{{ $('Webhook').first().json.body.conversation.id }},{{ $('Webhook').first().json.body.subscriber.lead_stage || 'A' }}
```

| $N | Campo | Fuente |
|----|-------|--------|
| $1 | `subscriber_id` UUID | `body.subscriber.id` |
| $2 | `conversation_id` UUID | `body.conversation.id` |
| $3 | `stage_slug` string | `body.subscriber.lead_stage` (fallback `'A'`) |

> **✅ Corregido en v7:** el `queryReplacement` está en formato comma-separated correcto.

## Salida esperada (N filas, una por slug_id enviado en esta etapa)

```json
[
  {
    "slug_id": "QC_A_VIDEO_HOOK",
    "last_sent_at": "2026-05-18T10:00:00Z",
    "ever_responded": true,
    "times_sent": 1
  },
  {
    "slug_id": "QC_A_AUDIO_FOLLOWUP",
    "last_sent_at": "2026-05-19T14:30:00Z",
    "ever_responded": false,
    "times_sent": 2
  }
]
```

## Salida cuando no hay historial (lead nuevo)

La query retorna 0 filas. `Build Context` itera `$('Get Content History').all()` → array vacío → `sentMap = {}` → todos los `content_options` salen con `last_sent: null`, `lead_responded_to_it: null`, `times_sent: 0`.

## Cómo lo consume Build Context

```javascript
const historyItems = $('Get Content History').all()
  .map(x => x.json);

const sentMap = {};
for (const h of historyItems) {
  if (h && h.slug_id) {
    sentMap[h.slug_id] = {
      last_sent_at:   h.last_sent_at,
      ever_responded: !!h.ever_responded,
      times_sent:     Number(h.times_sent) || 0
    };
  }
}
```

Luego cada `content_option` se enriquece:

```javascript
const sent = sentMap[slugId];
return {
  slug_id:              slugId,
  last_sent:            sent ? daysAgoText(sent.last_sent_at) : null,
  lead_responded_to_it: sent ? sent.ever_responded : null,
  times_sent:           sent ? sent.times_sent : 0
};
```

## Conexiones

- **Input:** `Get Subscriber CRM Context` (main)
- **Output:** `Combine Contexts` (input 1)

`alwaysOutputData: true` — si no hay filas, la cadena continúa sin error.
