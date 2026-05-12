# Nodo: AI Agent

**Tipo:** `@n8n/n8n-nodes-langchain.agent`  
**typeVersion:** 3.1

---

## Configuración

| Campo | Valor |
|-------|-------|
| Prompt type | `define` |
| Text | `={{ $json.chatInput }}` |
| System Message | `={{ $json.systemPrompt }}` |

---

## Sub-nodos conectados

| Sub-nodo | Tipo de conexión | Nodo |
|----------|-----------------|------|
| Groq Chat Model | `ai_languageModel` | → `AI Agent` |
| Postgres Chat Memory | `ai_memory` | → `AI Agent` |
| trigger_manychat_flow | `ai_tool` | → `AI Agent` |
| set_stage | `ai_tool` | → `AI Agent` |

---

## Tools conectadas al agente

### trigger_manychat_flow
**Tipo:** HTTP Request Tool  
**Method:** POST  
**URL:** `https://api.manychat.com/fb/sending/sendFlow`  
**Header:** `Authorization: Bearer {{ $('Build Context').first().json.mcApiKey }}`  
**Body:**
```json
{
  "subscriber_id": "{{ $('Build Context').first().json.subscriberId }}",
  "flow_ns": "{{ $fromAI('flow_name', 'El flow_name exacto de la lista disponible en el system prompt') }}"
}
```

> **Nota sobre `flow_ns`:** ManyChat usa el campo `ns` del flow (ej. `content20260511160051_518775`). El `flow_name` que el LLM recibe en el system prompt debe ser el `ns` directamente, o bien la tabla `flows_by_stage` debe incluir el mapeo `name → ns`. Ver `flows-catalog.md`.

### set_stage
**Tipo:** HTTP Request Tool  
**Method:** POST  
**URL:** `={{ 'https://api.revolicord.com/leads/' + $('Build Context').first().json.subscriberDbId + '/stage' }}`  
**Header:** `Authorization: Bearer <TOKEN_REVOLICORD_API>`  
**Body:**
```json
{
  "new_stage": "{{ $fromAI('new_stage', 'La nueva etapa del lead') }}",
  "reason": "{{ $fromAI('reason', 'Razón del cambio de etapa en una oración') }}",
  "evidence": "{{ $fromAI('evidence', 'Cita textual del mensaje del usuario que justifica el cambio') }}"
}
```

---

## Referencia al system prompt

Ver `system-prompt.md` para el prompt base completo y la sección de inyección dinámica de flows.
