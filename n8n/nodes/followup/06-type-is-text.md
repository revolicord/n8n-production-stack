# Nodo: Type is text? (Switch)

**Tipo:** Switch  
**ID:** `44dd4d15-cfca-46d5-bef9-6c8deff1cb07`  
**Posición en flujo:** 7 de 17 (después de Has Template? true)

---

## Propósito

Distingue entre los tres tipos de template de follow-up y enruta cada lead al nodo de envío correspondiente.

---

## Configuración

```json
{
  "mode": "rules",
  "rules": {
    "values": [
      {
        "conditions": {
          "combinator": "and",
          "conditions": [{ "leftValue": "={{ $json.followup_type }}", "operator": { "type": "string", "operation": "equals" }, "rightValue": "text" }],
          "options": { "caseSensitive": false, "typeValidation": "loose" }
        },
        "renameOutput": false
      },
      {
        "conditions": {
          "combinator": "and",
          "conditions": [{ "leftValue": "={{ $json.followup_type }}", "operator": { "type": "string", "operation": "equals" }, "rightValue": "flow" }],
          "options": { "caseSensitive": false, "typeValidation": "loose" }
        },
        "renameOutput": false
      },
      {
        "conditions": {
          "combinator": "and",
          "conditions": [{ "leftValue": "={{ $json.followup_type }}", "operator": { "type": "string", "operation": "equals" }, "rightValue": "content" }],
          "options": { "caseSensitive": false, "typeValidation": "loose" }
        },
        "renameOutput": false
      }
    ]
  },
  "options": {}
}
```

---

## Ramificación

| Salida | Condición | Destino |
|--------|-----------|---------|
| **0 (text)** | `followup_type === "text"` | → **sendContent** — texto puro vía `sendContent` |
| **1 (flow)** | `followup_type === "flow"` | → **sendFlow** — dispara flow de ManyChat |
| **2 (content)** | `followup_type === "content"` | → **Build Content Messages** → **sendContentMessages** |

---

## Nota de diseño (ADR-0020)

Convertido de IF (2 ramas) a Switch (3 ramas) en ADR-0020.  
Los templates `type='content'` envían imagen + texto construidos desde `followup_messages` vía `sendContent`.  
El antiguo comportamiento (`content` → `sendFlow` con `flow_ns=NULL`) generaba error silencioso en ManyChat.
