# Nodo: Prepare Data

**Tipo:** Code (JavaScript)  
**ID:** `bd2a127b-4bf9-48bf-966a-afb8cd6eb5d3`  
**Posición en flujo:** 3 de 17 (después de Get Due Leads, antes de Loop Over Leads)

---

## Propósito

Itera todos los items del batch y enriquece cada uno con:
- `textSent`: texto listo para enviar a ManyChat (nombre interpolado, o descripción del flow)
- `chatMemoryText`: texto para guardar en `n8n_chat_histories`, con prefijo de seguimiento

> **Nota:** En v2 este nodo quedó simplificado. Solo maneja `text` y `flow`. El tipo `content` se prepara más adelante en el nodo **Insert n8n_chat_histories** (Code).

---

## Código

```javascript
return items.map(item => {
  const d = item.json;
  const textSent = d.followup_type === 'text'
    ? (d.text_template || '').replace(/{{name}}/g, d.display_name || '')
    : '[flow: ' + (d.followup_flow_ns || '') + '] — ' + (d.followup_description || '');
  const chatMemoryText = '[SEGUIMIENTO AUTOMÁTICO #' + d.next_sequence_number + '] ' + textSent;
  return { json: { ...d, textSent, chatMemoryText } };
});
```

---

## Campos añadidos al item

| Campo | Descripción |
|-------|-------------|
| `textSent` | Para `text`: template con `{{name}}` reemplazado por `display_name`. Para `flow/content`: `[flow: <flow_ns>] — <description>` |
| `chatMemoryText` | `[SEGUIMIENTO AUTOMÁTICO #N] <textSent>` |

---

## Limitación conocida

El campo `textSent` para tipo `content` muestra el namespace del flow en vez del contenido real. La memoria de chat correcta para tipo `content` se genera en el nodo **Insert n8n_chat_histories** (Code), que sí accede a `image_context` y `content_text`.
