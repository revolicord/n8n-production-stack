# Nodo: Structured Output Parser

**Tipo:** `@n8n/n8n-nodes-langchain.outputParserStructured`  
**ID:** `69e2e6a5-1d90-4cec-82c9-a79bed05d827`  
**typeVersion:** 1.3  
**Conexión:** `ai_outputParser` → `AI Agent`  
**ADR:** ⚠️ *Pendiente asignar*

---

## Propósito

Valida y parsea la salida del AI Agent contra un JSON Schema estricto. Con `autoFix: true`, si el modelo produce JSON malformado, el parser reintenta con una corrección automática. Garantiza que `$json.output` siempre tenga la estructura `{ reasoning, actions[] }` antes de llegar al Router.

---

## Configuración

| Campo | Valor |
|-------|-------|
| Schema Type | `manual` |
| Auto Fix | `true` |
| Credencial LLM | `Anthropic account` (comparte el mismo `lmChatAnthropic` que el AI Agent) |

> **Nota:** El Anthropic Chat Model está conectado tanto al AI Agent (vía `ai_languageModel`) como a este parser (vía `ai_languageModel`). n8n permite múltiples conexiones desde el mismo nodo de modelo.

---

## JSON Schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["reasoning", "actions"],
  "properties": {
    "reasoning": {
      "type": "string",
      "minLength": 1,
      "description": "1-2 frases internas explicando por qué se eligió este plan. No se envía al lead."
    },
    "actions": {
      "type": "array",
      "minItems": 0,
      "maxItems": 6,
      "description": "Lista ordenada de acciones que el Router ejecutará en secuencia. Vacío = no hacer nada este turno.",
      "items": {
        "oneOf": [
          {
            "type": "object",
            "additionalProperties": false,
            "required": ["type", "slug_id", "evidence"],
            "properties": {
              "type":     { "const": "send_content" },
              "slug_id":  { "type": "string", "minLength": 1 },
              "evidence": { "type": "string", "minLength": 1 }
            }
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": ["type", "new_stage", "reason", "evidence"],
            "properties": {
              "type":      { "const": "change_stage" },
              "new_stage": { "type": "string", "enum": ["MS", "B", "C", "D", "disqualified"] },
              "reason": {
                "anyOf": [
                  { "type": "null" },
                  { "type": "string", "enum": ["no_money", "not_interested", "geographic", "no_quality", "fake_account"] }
                ]
              },
              "evidence": { "type": "string", "minLength": 1 },
              "lead_in": {
                "type": "string",
                "minLength": 1,
                "maxLength": 200,
                "description": "Frase humana opcional. OBLIGATORIO para new_stage='C' y new_stage='disqualified'."
              }
            }
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": ["type", "text"],
            "properties": {
              "type": { "const": "reply_text" },
              "text": { "type": "string", "minLength": 1, "maxLength": 200 }
            }
          }
        ]
      }
    }
  }
}
```

---

## Notas

- Ver `02-ai-agent.md` para la documentación completa del AI Agent y cómo el Router consume el output.
- Ver `08-router-v1.md` para el detalle de cómo se ejecutan los `actions`.
