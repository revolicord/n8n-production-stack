# Nodo 03: Prepare Data

**Tipo:** Code (`n8n-nodes-base.code`)  
**ID:** `ba2ab3a7-205c-4e15-8e3d-07390e50b185`  
**Posición en cadena:** después de `Get Due Leads`, antes de `Loop Over Leads`  
**Propósito:** Interpolar el template de texto con `{{name}}` y construir el string `chatMemoryText` que se insertará en `n8n_chat_histories`.

---

## Código

```js
return items.map(item => {
  const d = item.json;

  const textSent = d.followup_type === 'text'
    ? (d.text_template || '').replace(/{{name}}/g, d.display_name || '')
    : '[flow: ' + (d.followup_flow_ns || '') + '] — ' + (d.followup_description || '');

  const chatMemoryText =
    '[SEGUIMIENTO AUTOMÁTICO #' + d.next_sequence_number + '] ' + textSent;

  return { json: { ...d, textSent, chatMemoryText } };
});
```

## Campos añadidos al ítem

| Campo | Descripción |
|-------|-------------|
| `textSent` | Texto listo para enviar (interpolado o descripción del flow) |
| `chatMemoryText` | `[SEGUIMIENTO AUTOMÁTICO #N] <textSent>` — se almacena en memoria del agente |

## Lógica de interpolación

- `type === 'text'` → reemplaza todas las ocurrencias de `{{name}}` por `display_name`.
- Cualquier otro tipo (flow) → genera un placeholder descriptivo con `followup_flow_ns` y `followup_description`.

## Notas

- El nodo es `map` puro: no filtra ni descarta ítems; todos pasan al Loop.
- `display_name` puede ser vacío — en ese caso `{{name}}` se reemplaza por string vacío (comportamiento aceptable).
- Si se añaden más variables de plantilla (ej. `{{stage}}`), extender el `.replace()` aquí.
