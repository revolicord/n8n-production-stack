# Nodo 05: Has Template?

**Tipo:** IF (`n8n-nodes-base.if`)  
**ID:** `636723fe-bea5-4d8c-96ae-9e117f613663`  
**Posición en cadena:** después de `Loop Over Leads`, antes de `Type is text?` o `Archive lead_crons`  
**Propósito:** Verificar si existe un template para el `next_sequence_number` actual del lead. Si no hay template, la secuencia está agotada y el cron se archiva.

---

## Condición

```
$json.template_id  existe  (operator: string → exists)
```

| Resultado | Salida | Destino |
|-----------|--------|---------|
| `true` — `template_id` tiene valor | Output 0 (true) | **Type is text?** |
| `false` — `template_id` es null/undefined | Output 1 (false) | **Archive lead_crons** |

## Configuración

```json
{
  "conditions": {
    "combinator": "and",
    "conditions": [
      {
        "id": "c1",
        "leftValue": "=$json.template_id",
        "operator": { "type": "string", "operation": "exists" },
        "rightValue": ""
      }
    ]
  },
  "options": { "typeValidation": "strict" }
}
```

## Notas

- `template_id` llega como NULL cuando el LEFT JOIN de **Get Due Leads** no encuentra template para `(stage_id, next_sequence_number)`. Un NULL pasa el operador `exists` como `false`.
- Este nodo es el único punto de decisión entre "hay algo que enviar" y "la secuencia se agotó".
