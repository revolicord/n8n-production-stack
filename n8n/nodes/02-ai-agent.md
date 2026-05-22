# Nodo: AI Agent

**Tipo:** `@n8n/n8n-nodes-langchain.agent`  
**typeVersion:** 3.1  
**Versión del sistema:** v3 (sin herramientas — Structured Output)

---

## Configuración

| Campo | Valor |
|-------|-------|
| Prompt type | `define` |
| Text | `={{ $json.chatInput }}` |
| System Message | `={{ $json.systemPrompt }}` |
| Return Intermediate Steps | `false` |
| Has Output Parser | `true` (conectado al Structured Output Parser) |

---

## Sub-nodos conectados

| Sub-nodo | Tipo de conexión | Nodo |
|----------|-----------------|------|
| Anthropic Chat Model | `ai_languageModel` | → `AI Agent` |
| Postgres Chat Memory | `ai_memory` | → `AI Agent` |
| Structured Output Parser | `ai_outputParser` | → `AI Agent` |

> **v3 no tiene herramientas.** Las tools `trigger_manychat_flow` y `set_stage` (v2) fueron eliminadas. El agente ahora devuelve un JSON plan que el **Router** ejecuta.

---

## Anthropic Chat Model

**Tipo:** `@n8n/n8n-nodes-langchain.lmChatAnthropic`  
**typeVersion:** 1.5

| Campo | Valor |
|-------|-------|
| Model | `claude-sonnet-4-6` |
| Temperature | `0.3` |
| Credencial | `Anthropic account` (id: `CqaNlJsRteqVJlUs`) |

> El campo `tenant.config.model` del payload (ej. `"gpt-4o-mini"`) es **ignorado** — el modelo está hardcoded en este nodo.

---

## Postgres Chat Memory

**Tipo:** `@n8n/n8n-nodes-langchain.memoryPostgresChat`  
**typeVersion:** 1.3

| Campo | Valor |
|-------|-------|
| Session ID Type | `customKey` |
| Session Key | `=$json.subscriberId` (expresión: `$json.subscriberId`) |

> `subscriberId` = `manychat_subscriber_id` numérico (ej. `"1724803790"`), no el UUID interno. Esto aisla la memoria conversacional por subscriber de ManyChat.

---

## Structured Output Parser

**Tipo:** `@n8n/n8n-nodes-langchain.outputParserStructured`  
**typeVersion:** 1.3

| Campo | Valor |
|-------|-------|
| Schema Type | `manual` |
| Auto Fix | `true` |

### JSON Schema esperado del agente

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
                "description": "Frase humana opcional. OBLIGATORIO para new_stage='C' (precede al link de Calendly) y new_stage='disqualified' (despedida). IGNORADO para MS y B."
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

> **Arquitectura de acciones:** el agente ya no devuelve campos planos (`send_content`, `change_stage`, `reply_text`). Devuelve un array `actions` ordenado. El Router itera las acciones en orden y las ejecuta secuencialmente. Puede haber múltiples acciones de distintos tipos en un mismo turno (ej: `send_content` + `reply_text`).

> **`lead_in` en `change_stage`:** campo opcional en el schema pero OBLIGATORIO lógicamente para transiciones a `C` (frase antes del calendly) y `disqualified` (frase de despedida). El Router lo usa en macros `reply_text_dynamic` / `reply_text_with_link`.

> **`reason` en `change_stage`:** null para todas las transiciones excepto `disqualified`, donde debe ser uno de: `no_money`, `not_interested`, `geographic`, `no_quality`, `fake_account`.

---

## Salida del AI Agent

El AI Agent (con Structured Output Parser) emite un objeto JSON en `$json.output`:

```json
{
  "output": {
    "reasoning": "Lead en etapa A reaccionó positivo al hook. Emitimos change_stage A→MS para arrancar la cascada que enviará audio + VSL.",
    "actions": [
      {
        "type": "change_stage",
        "new_stage": "MS",
        "reason": null,
        "evidence": "👍"
      }
    ]
  }
}
```

Otro ejemplo (lead en B responde positivo → ir a C con calendly):
```json
{
  "output": {
    "reasoning": "Reacción positiva tras la VSL. Transicionar a C y proveer link de Calendly.",
    "actions": [
      {
        "type": "change_stage",
        "new_stage": "C",
        "reason": null,
        "evidence": "sí mándame el link",
        "lead_in": "Genial, te paso el enlace para que elijas el horario que mejor te venga:"
      }
    ]
  }
}
```

El Router lee esto como:
```javascript
const plan = agentOutput.output || agentOutput;
const agentActions = Array.isArray(plan.actions) ? plan.actions.slice() : [];
```

---

## Referencia al system prompt

Ver `system-prompt.md` y el nodo `00c-system-prompt.md` para el prompt completo.
El prompt le instruye al agente el formato JSON exacto esperado y las reglas de decisión.
