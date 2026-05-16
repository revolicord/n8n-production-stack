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

Las dos tools son **Code Tool** (`@n8n/n8n-nodes-langchain.toolCode`) con **schemaType `manual`** y un **JSON Schema explícito** para los argumentos del LLM. Esto da tres cosas que la versión anterior con HTTP Request Tool no daba:

- `new_stage` queda como enum estricto: el modelo solo puede emitir uno de los seis valores válidos.
- `evidence` queda como campo requerido — cero cambios de etapa sin cita textual del lead.
- Cuando el endpoint devuelve 4xx, el JS formatea el error como string entendible para el LLM en lugar de devolver un objeto crudo.

### trigger_manychat_flow

**Tipo:** Code Tool (`@n8n/n8n-nodes-langchain.toolCode`)
**Schema Type:** `Define using JSON Schema` (manual)

**Description:**
```
Envía un flow de ManyChat al lead (vídeo, audio, imagen). Úsala SOLO con el flow_ns exacto que aparece en la sección "CONTENIDO DISPONIBLE" del contexto — no inventes ns, no uses nombres semánticos. Build Context ya seleccionó el flow correcto para esta etapa; tu trabajo es decidir el momento conversacional para dispararlo. Una sola llamada por turno.
```

**Input Schema:**
```json
{
  "type": "object",
  "required": ["flow_ns"],
  "properties": {
    "flow_ns": {
      "type": "string",
      "pattern": "^content\\d+_\\d+$",
      "description": "El ns exacto del flow de ManyChat (formato content<digits>_<digits>). Cópialo tal cual de la sección CONTENIDO DISPONIBLE del system prompt — no inventes este valor."
    }
  },
  "additionalProperties": false
}
```

**JS Code:**
```javascript
const { flow_ns } = query;

const subscriberId = $('Build Context').first().json.subscriberId;
const mcApiKey     = $('Build Context').first().json.mcApiKey;

try {
  const res = await this.helpers.httpRequest({
    method: 'POST',
    url: 'https://api.manychat.com/fb/sending/sendFlow',
    headers: {
      Authorization: `Bearer ${mcApiKey}`,
      'Content-Type': 'application/json',
    },
    body: { subscriber_id: subscriberId, flow_ns },
    json: true,
    returnFullResponse: true,
  });

  if (res.statusCode === 200 && res.body?.status === 'success') {
    return `ok: flow ${flow_ns} sent to subscriber ${subscriberId}`;
  }
  return `error: ManyChat ${res.statusCode} — ${JSON.stringify(res.body)}`;
} catch (err) {
  return `error: ${err.message ?? 'sendFlow request failed'}`;
}
```

> **Nota sobre `flow_ns`:** ManyChat usa el campo `ns` del flow (ej. `content20260511160051_518775`). Build Context inyecta el `ns` directamente en la sección CONTENIDO DISPONIBLE; el LLM lo copia tal cual. Ver `flows-catalog.md`.

### set_stage

**Tipo:** Code Tool (`@n8n/n8n-nodes-langchain.toolCode`)
**Schema Type:** `Define using JSON Schema` (manual)

**Description:**
```
Avanza la etapa del lead en el funnel cuando hay evidencia textual clara de que el lead cumple el criterio de la siguiente etapa, o márcalo como disqualified si no es viable. Solo úsala cuando estás seguro: requiere citar el mensaje del lead que justifica el cambio. Una etapa por vez, sin saltos (A→MS→B→C→D). Para disqualified, el reason debe ser uno de: no_money, not_interested, geographic, no_quality, fake_account.
```

**Input Schema:**
```json
{
  "type": "object",
  "required": ["new_stage", "reason", "evidence"],
  "properties": {
    "new_stage": {
      "type": "string",
      "enum": ["A", "MS", "B", "C", "D", "disqualified"],
      "description": "Nueva etapa del lead. A=Initiated, MS=Media Seen (vio Vídeo 1), B=Engaged (reaccionó positivo al VSL), C=Calendly'd (recibió link), D=Booked (confirmó reserva), disqualified=descalificado."
    },
    "reason": {
      "type": "string",
      "description": "Motivo breve del cambio en una oración. Si new_stage=disqualified debe ser exactamente uno de: no_money | not_interested | geographic | no_quality | fake_account."
    },
    "evidence": {
      "type": "string",
      "minLength": 1,
      "description": "Cita textual del último mensaje del lead que justifica el cambio. Copia las palabras del lead tal cual, sin parafrasear."
    }
  },
  "additionalProperties": false
}
```

**JS Code:**
```javascript
const { new_stage, reason, evidence } = query;

const subscriberDbId = $('Build Context').first().json.subscriberDbId;
const turnId         = $('Build Context').first().json.turnId;
const callbackToken  = $('Build Context').first().json.callbackToken;

try {
  const res = await this.helpers.httpRequest({
    method: 'POST',
    url: `https://api.revolicord.com/admin/leads/${subscriberDbId}/stage`,
    headers: {
      Authorization: `Bearer ${callbackToken}`,
      'Content-Type': 'application/json',
    },
    body: { new_stage, reason, evidence, turn_id: turnId },
    json: true,
    returnFullResponse: true,
  });

  if (res.statusCode === 200) {
    const { stage, changed, from } = res.body;
    return changed
      ? `ok: stage changed ${from} → ${stage}`
      : `ok: stage already ${stage} (no change)`;
  }
  return `error: HTTP ${res.statusCode} — ${JSON.stringify(res.body)}`;
} catch (err) {
  return `error: ${err.message ?? 'set_stage request failed'}`;
}
```

> **Nota sobre `query`:** en `toolCode` con schema manual los args estructurados del LLM llegan en la variable `query`. Si al pegar n8n usa otra convención (ej. `$input.first().json`), ajustar el destructuring.

---

## Referencia al system prompt

Ver `system-prompt.md` para el prompt base completo y la sección de inyección dinámica de flows.
