# Nodo 07c: Send Content Messages (type='content')

**Tipo:** HTTP Request (`n8n-nodes-base.httpRequest`)  
**Posición en cadena:** rama `content` del Switch (nodo 06), antes de `After Send`  
**Propósito:** Enviar imagen + texto al suscriptor vía `sendContent` de ManyChat cuando el template es `type='content'`. Los mensajes vienen del campo `followup_messages` (array JSON del nodo 02).

---

## Prerequisito: Code node antes del HTTP Request

Agregar un **Code node** entre el Switch y este HTTP Request para construir el payload:

```javascript
// Interpola {{name}} en text_content y construye el array de mensajes ManyChat
const item = $input.item.json;
const displayName = item.display_name ?? 'amig@';
const rawMessages = Array.isArray(item.followup_messages) ? item.followup_messages : [];

const mcMessages = rawMessages
  .sort((a, b) => a.sort_order - b.sort_order)
  .map((m) => {
    if (m.message_type === 'image') {
      return { type: 'image', url: m.media_url };
    }
    const text = (m.text_content ?? '').replace(/\{\{name\}\}/g, displayName);
    return { type: 'text', text };
  });

return [{ json: { ...item, mcMessages, textSent: rawMessages.map(m => m.text_content).filter(Boolean).join(' | ') } }];
```

---

## Request

```
POST https://api.manychat.com/fb/sending/sendContent
```

### Headers

| Header | Valor |
|--------|-------|
| `Authorization` | `Bearer <mc_api_key>` |

### Body (JSON)

```json
{
  "subscriber_id": "<manychat_subscriber_id>",
  "data": {
    "version": "v2",
    "content": {
      "type": "instagram",
      "messages": "<mcMessages>"
    }
  }
}
```

### Configuración n8n (jsonBody expression)

```javascript
=JSON.stringify({
  subscriber_id: $json.manychat_subscriber_id,
  data: {
    version: 'v2',
    content: {
      type: 'instagram',
      messages: $json.mcMessages
    }
  }
})
```

---

## Cambios necesarios en nodo 06 — Type is text?

Convertir el nodo **If** actual en un nodo **Switch**:
- Regla 1: `{{ $json.followup_type }}` igual a `text` → output 0 → 07a
- Regla 2: `{{ $json.followup_type }}` igual a `flow` → output 1 → 07b  
- Regla 3: `{{ $json.followup_type }}` igual a `content` → output 2 → (Code node + 07c)

---

## Cambios en nodo 02 — Get Due Leads SQL

Agregar al SELECT el subquery de mensajes:

```sql
COALESCE(
  (
    SELECT json_agg(
      json_build_object(
        'message_type', fm.message_type,
        'text_content', fm.text_content,
        'media_url',    fm.media_url,
        'sort_order',   fm.sort_order
      ) ORDER BY fm.sort_order ASC
    )
    FROM api.followup_messages fm
    WHERE fm.template_id = ft.id
  ),
  '[]'::json
) AS followup_messages
```

---

## Notas

- El Code node antes de 07c reusa el campo `textSent` (join de textos) para el nodo 08/09 (log + memoria).
- ManyChat acepta `{ type: 'image', url: '...' }` para imágenes; la URL debe ser pública (MinIO bucket `assets` con `anonymous set download`).
- Conectar 07c a nodo 08 `After Send` igual que 07a y 07b.
