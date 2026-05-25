# Nodo: Has Template?

**Tipo:** If  
**ID:** `26600806-3b2a-44c9-b611-7266269701f1`  
**Posición en flujo:** 5 de 17 (después de Loop Over Leads)

---

## Propósito

Verifica si existe una plantilla de follow-up para el `next_sequence_number` actual del lead. Si no existe, el lead ha superado el máximo de follow-ups definidos.

---

## Configuración

```json
{
  "conditions": {
    "combinator": "and",
    "conditions": [
      {
        "id": "c1",
        "leftValue": "={{ $json.template_id }}",
        "operator": { "type": "string", "operation": "exists" },
        "rightValue": ""
      }
    ],
    "options": {
      "caseSensitive": true,
      "typeValidation": "strict"
    }
  }
}
```

---

## Ramificación

| Salida | Condición | Destino |
|--------|-----------|---------|
| **true (0)** | `template_id` existe | → **Type is text?** |
| **false (1)** | `template_id` es null/undefined | → **Archive lead_crons** |

---

## Nota de versión

En v1 el nodo usaba `typeVersion: 2.3` y la expresión `=$json.template_id` (sin `{{ }}`).  
En v2 usa `typeVersion: 2.2` y la expresión correcta `={{ $json.template_id }}`.
