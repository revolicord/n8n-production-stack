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
Envía un flow de ManyChat al lead (vídeo, audio, imagen). Úsala SOLO con el flow_name EXACTO que aparece en la sección "CONTENIDO DISPONIBLE" del contexto — cópialo carácter por carácter. Nunca lo traduzcas, parafrasees ni inventes. Build Context ya seleccionó el flow correcto para esta etapa; tu trabajo es decidir el momento conversacional para dispararlo. Una sola llamada por turno.
```

**Input Schema:**
```json
{
  "type": "object",
  "required": ["flow_name"],
  "properties": {
    "flow_name": {
      "type": "string",
      "pattern": "^content[0-9]+_[0-9]+$",
      "description": "EXACT ns string from CONTENIDO DISPONIBLE. Must be copied character-for-character from the context block. Never paraphrase, never translate, never invent. Format: 'content' followed by digits, underscore, then digits (e.g., content20260511155655_840313)."
    }
  }
}
```

> **NO usar `additionalProperties: false`:** en n8n 2.20.6 las Code Tools reciben el item completo del flujo (todos los campos de Build Context + `toolCallId`), no solo los argumentos del LLM. Con `additionalProperties: false` la validación zod rechaza todo con "Unrecognized key(s)". Dejarlo abierto (default) permite que el schema valide solo `flow_name` e ignore el resto.

> **Sobre el naming:** la IA emite `flow_name` (intuitivo para el modelo); el código lo mapea a `flow_ns` al hablar con la API de ManyChat (que conserva el nombre técnico). Build Context inyecta el `ns` directamente en la sección CONTENIDO DISPONIBLE; el LLM lo copia tal cual.

**JS Code:**
```javascript
const { flow_name } = query;

// 1) Validación defensiva del parámetro del LLM
//    (el JSON Schema con pattern debería filtrar, pero blindamos por si acaso)
if (!flow_name || typeof flow_name !== 'string') {
  return `error: parámetro flow_name ausente o no es string. Recibido: ${JSON.stringify(flow_name)}`;
}
if (!/^content[0-9]{14}_[0-9]+$/.test(flow_name)) {
  return `error: flow_name "${flow_name}" no cumple el formato (content + 14 dígitos + _ + dígitos). Copia el ns EXACTO del bloque CONTENIDO DISPONIBLE del prompt — no inventes ni traduzcas.`;
}

// 2) Lee contexto dinámico desde Build Context
let subscriberId, mcApiKey;
try {
  const ctx = $('Build Context').first().json;
  subscriberId = ctx.subscriberId;
  mcApiKey     = ctx.mcApiKey;
} catch (err) {
  return `error interno: no se pudo leer Build Context (${err.message ?? err})`;
}
if (!subscriberId) return `error interno: subscriberId ausente en Build Context`;
if (!mcApiKey)     return `error interno: mcApiKey ausente en Build Context`;

// 3) Llamada a ManyChat
const url = 'https://api.manychat.com/fb/sending/sendFlow';
try {
  const res = await this.helpers.httpRequest({
    method: 'POST',
    url: url,
    headers: {
      Authorization: `Bearer ${mcApiKey}`,
      'Content-Type': 'application/json',
    },
    body: { subscriber_id: subscriberId, flow_ns: flow_name },
    json: true,
    returnFullResponse: true,
  });

  if (res.statusCode === 200 && res.body && res.body.status === 'success') {
    return `ok: flow ${flow_name} enviado a subscriber ${subscriberId}`;
  }
  return `error: ManyChat respondió ${res.statusCode} — ${JSON.stringify(res.body)}`;
} catch (err) {
  const status = err.statusCode || err.httpCode || 'unknown';
  const body   = err.response?.body || err.body || err.message || String(err);
  return `error: ManyChat ${status} — ${typeof body === 'string' ? body : JSON.stringify(body)}`;
}
```

> **Por qué este código devuelve strings y no lanza:** las AI Tools en n8n LangChain devuelven el `return` al modelo como observación. Si tiramos excepción, el modelo recibe un error de runtime; si devolvemos string "error: ...", el modelo lo lee y puede corregir (por ejemplo, reintentar con el `flow_name` correcto del contexto). Misma razón para validar el regex en el código además de en el schema: aunque el schema rechazaría el call inválido, si en el futuro lo aflojamos el JS sigue siendo barrera.

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
  }
}
```

> **NO usar `additionalProperties: false`** aquí tampoco — mismo motivo que en `trigger_manychat_flow`: las Code Tools reciben el item completo del flujo, y zod rechazaría todo con "Unrecognized key(s)".

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
