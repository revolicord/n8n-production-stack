# Nodo 06: Type is text?

**Tipo:** IF (`n8n-nodes-base.if`)  
**ID:** `bdf42cbb-bd06-4f75-af68-a88471b114b1`  
**Posición en cadena:** rama TRUE de `Has Template?`, antes de `sendContent` o `sendFlow`  
**Propósito:** Distinguir entre los dos tipos de mensaje ManyChat: texto directo (`sendContent`) o lanzamiento de un flow (`sendFlow`).

---

## Condición

```
$json.followup_type  igual a  "text"
```

| Resultado | Salida | Destino |
|-----------|--------|---------|
| `true` — tipo es `'text'` | Output 0 (true) | **sendContent** |
| `false` — cualquier otro valor (`'flow'`, etc.) | Output 1 (false) | **sendFlow** |

## Configuración

```json
{
  "conditions": {
    "combinator": "and",
    "conditions": [
      {
        "id": "c2",
        "leftValue": "=$json.followup_type",
        "operator": { "type": "string", "operation": "equals" },
        "rightValue": "text"
      }
    ]
  },
  "options": {
    "caseSensitive": false,
    "typeValidation": "loose"
  }
}
```

## Notas

- `caseSensitive: false` — tolerante a variaciones de mayúsculas en la columna `followup_templates.type`.
- Si se añade un tercer tipo en el futuro (ej. `'image'`), este nodo debe convertirse en un Switch.
