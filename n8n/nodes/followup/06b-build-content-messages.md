# Nodo: Build Content Messages

**Tipo:** Code (JavaScript)  
**ID:** `a4b5c6d7-e8f9-4012-a4b5-c6d7e8f90123`  
**Posición en flujo:** output 2 del Switch (content) → sendContentMessages

---

## Propósito

Construye el array `mcMessages` que ManyChat espera en `sendContent`, interpolando `{{name}}` con `display_name` del suscriptor. Lee los mensajes del campo `followup_messages` (json_agg del nodo Get Due Leads).

---

## Código

```javascript
const item = $input.item.json;
const displayName = item.display_name ?? 'amig@';
const rawMessages = Array.isArray(item.followup_messages) ? item.followup_messages : [];

const mcMessages = rawMessages
  .sort((a, b) => a.sort_order - b.sort_order)
  .map((m) => {
    if (m.message_type === 'image') return { type: 'image', url: m.media_url };
    const text = (m.text_content ?? '').replace(/\{\{name\}\}/g, displayName);
    return { type: 'text', text };
  });

return [{ json: { ...item, mcMessages } }];
```

---

## Campos de entrada

| Campo | Fuente | Uso |
|-------|--------|-----|
| `followup_messages` | Get Due Leads (json_agg) | Array de `{message_type, text_content, media_url, sort_order}` |
| `display_name` | `subscribers.display_name` | Reemplaza `{{name}}` en text_content |

## Campos de salida añadidos

| Campo | Descripción |
|-------|-------------|
| `mcMessages` | Array de mensajes ManyChat: `[{type:'image',url:'...'}, {type:'text',text:'...'}]` |

---

## Conexión posterior

→ **sendContentMessages**
