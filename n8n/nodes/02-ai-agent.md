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
  "required": ["reasoning", "send_content", "change_stage", "reply_text"],
  "properties": {
    "reasoning": {
      "type": "string",
      "minLength": 1
    },
    "send_content": {
      "anyOf": [
        { "type": "null" },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["slug_id", "evidence"],
          "properties": {
            "slug_id": { "type": "string", "minLength": 1 },
            "evidence": { "type": "string", "minLength": 1 }
          }
        }
      ]
    },
    "change_stage": {
      "anyOf": [
        { "type": "null" },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["new_stage", "reason", "evidence"],
          "properties": {
            "new_stage": {
              "type": "string",
              "enum": ["MS", "B", "C", "D", "disqualified"]
            },
            "reason": {
              "anyOf": [
                { "type": "null" },
                {
                  "type": "string",
                  "enum": ["no_money", "not_interested", "geographic", "no_quality", "fake_account"]
                }
              ]
            },
            "evidence": { "type": "string", "minLength": 1 }
          }
        }
      ]
    },
    "reply_text": {
      "anyOf": [
        { "type": "null" },
        { "type": "string", "minLength": 1, "maxLength": 200 }
      ]
    }
  }
}
```

> **Nota sobre `new_stage`:** el enum no incluye `"A"` — el agente nunca puede retroceder a la etapa inicial. Las transiciones permitidas dinámicamente vienen en `stage.valid_transitions` del contexto; el schema es la valla dura de tipos.

> **`reason` solo requerido en `disqualified`:** para cualquier otra transición, `reason` es `null`. Para `disqualified`, debe ser uno de los 5 valores del enum.

---

## Salida del AI Agent

El AI Agent (con Structured Output Parser) emite un objeto JSON en `$json.output`:

```json
{
  "output": {
    "reasoning": "El lead acaba de enviar un pulgar arriba. Eso indica que quiso reaccionar. Etapa A, primera interacción — enviamos el video hook.",
    "send_content": {
      "slug_id": "QC_A_VIDEO_HOOK",
      "evidence": "👍"
    },
    "change_stage": null,
    "reply_text": null
  }
}
```

El Router lee esto como:
```javascript
const plan = agentOutput.output || agentOutput;
```

---

## Referencia al system prompt

Ver `system-prompt.md` y el nodo `00c-system-prompt.md` para el prompt completo.
El prompt le instruye al agente el formato JSON exacto esperado y las reglas de decisión.
