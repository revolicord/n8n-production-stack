# Nodo: Type is text?

**Tipo:** If  
**Posición en flujo:** 6 de 15 (después de Has Template? true)

---

## Propósito

Distingue si el template es de tipo `text` (mensaje directo) o cualquier otro tipo (`flow`, `content`). Ramifica hacia el nodo de envío correspondiente.

---

## Configuración

```json
{
  "conditions": {
    "combinator": "and",
    "conditions": [
      {
        "id": "c2",
        "leftValue": "={{ $json.followup_type }}",
        "operator": { "type": "string", "operation": "equals" },
        "rightValue": "text"
      }
    ],
    "options": {
      "caseSensitive": false,
      "typeValidation": "loose"
    }
  }
}
```

---

## Ramificación

| Salida | Condición | Destino |
|--------|-----------|---------|
| **true (0)** | `followup_type === "text"` | → **sendContent** |
| **false (1)** | `followup_type !== "text"` (flow, content) | → **sendFlow** |

---

## Nota de diseño

Los tipos `flow` y `content` se envían ambos via `sendFlow` (ManyChat `sendFlow` API). El tipo `content` incluye imágenes y texto enriquecido gestionados por el flow de ManyChat, no por mensajes individuales.
