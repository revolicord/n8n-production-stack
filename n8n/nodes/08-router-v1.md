# Nodo: Router

**Tipo:** Code (JavaScript)  
**Versión:** v4.5  
**Nombre en UI:** `Router`  
**Posición en cadena:** Después de `AI Agent`, antes de `If`  
**Propósito:** Ejecutar el plan emitido por el AI Agent — iterar el array `actions`, llamar a ManyChat API (`sendFlow`, `sendContent`) y al API interno (`set-stage`), disparar macros de transición con cascadas, y propagar `insert_content_sent` para el nodo `If`.

---

## Versiones

| v | Cambio principal |
|---|-----------------|
| v1 | Plan plano: `send_content`, `change_stage`, `reply_text` como campos separados |
| v2 | Migración a `actions` array; macros de cascada básicas |
| v3 | Retry de red exponencial; fail-loud en errores no transitorios |
| v4 | `reply_text_dynamic` y `reply_text_with_link` — texto del agente (`lead_in`) fluye a macros |
| v4.1 | Sin cambios de lógica (refactor interno) |
| v4.2 | Fix bug "MS→B busca audios donde no están": `lookup_stage` en macros para resolver slugs cross-stage |
| v4.3 | Fix: `withRetry` adjunta `__attempts`/`__retried` al error antes de rethrow; el catch de `execSendContent` lo usa en vez de hardcodear `attempts:3`. También añade `ECONNABORTED` a códigos retryables para que los timeouts de axios se reintenten. |
| v4.4 | Fix: `RangeError: Maximum call stack size exceeded` en `observable-object.ts` — el `json` de salida se envuelve en `JSON.parse(JSON.stringify(...))` para eliminar los ObservableObject proxies de n8n que venían de `$input` (agentActions, trace.action) antes de que n8n intente re-envolverlos. |
| **v4.5** | Sube timeout de `callManychatFlow` y `callManychatText` de 15 000 ms a 30 000 ms para absorber picos de latencia en la API de ManyChat que agotaban los 3 reintentos. |

---

## Arquitectura

### TRANSITION_MACROS

Tabla de macros declarativa. Cuando el agente emite un `change_stage` que coincide con una clave `FROM->TO`, el Router ejecuta automáticamente las acciones del array `after` en secuencia.

```javascript
const TRANSITION_MACROS = {
  'A->MS': {
    after: [
      { type: 'send_content', slug_id: 'QC_MS_AUDIO_se envia antes de la vsl',     evidence: 'auto: cascada A->MS' },
      { type: 'send_content', slug_id: 'QC_MS_VIDEO_vsl que demuestra resultados', evidence: 'auto: cascada A->MS' },
      { type: 'change_stage', new_stage: 'B',                                       evidence: 'auto: contenido core entregado tras 👍 al hook' }
    ]
  },
  'MS->B': {
    lookup_stage: 'MS',   // los slugs viven en MS, no en B (el destino de la transición)
    after: [
      { type: 'send_content', slug_id: 'QC_MS_AUDIO_se envia antes de la vsl',     evidence: 'auto: cascada MS->B' },
      { type: 'send_content', slug_id: 'QC_MS_VIDEO_vsl que demuestra resultados', evidence: 'auto: cascada MS->B' }
    ]
  },
  'B->C': {
    after: [ { type: 'reply_text_with_link', source_url: 'calendly_url', fallback_text: 'Aquí tienes, elige el horario que te venga: {link}' } ]
  },
  'A->disqualified':  { after: [ { type: 'reply_text_dynamic', fallback_text: 'Vale, no es tu momento. Éxitos.' } ] },
  'MS->disqualified': { after: [ { type: 'reply_text_dynamic', fallback_text: 'Vale, no es tu momento. Éxitos.' } ] },
  'B->disqualified':  { after: [ { type: 'reply_text_dynamic', fallback_text: 'Vale, no es tu momento. Éxitos.' } ] },
  'C->disqualified':  { after: [ { type: 'reply_text_dynamic', fallback_text: 'Vale, no es tu momento. Éxitos.' } ] }
};
```

**`lookup_stage`:** cuando una macro envía `send_content`, el Router resuelve `slug_id → flow_ns` contra este stage en `stageFlowsBySlug` (de Build Context). Si no se declara, usa el stage destino de la transición. Necesario para `MS→B` porque los audios/VSL viven en stage MS, no en B.

### Tipos de acción internos

| Tipo | Qué hace |
|------|----------|
| `send_content` | `POST sendFlow` a ManyChat con el `flow_ns` resuelto desde `stageFlowsBySlug` o `selectedVariants` |
| `change_stage` | `POST /admin/leads/:subscriberDbId/stage` al API interno |
| `reply_text` | `POST sendContent` con texto libre a ManyChat |
| `reply_text_with_link` | Igual que `reply_text` pero concatena `{url}` desde `tenantUrls` (ej: calendly_url) después del `lead_in` del agente |
| `reply_text_dynamic` | Igual que `reply_text` pero usa `action.__lead_in` (campo inyectado desde el `change_stage` del agente) o `fallback_text` |

### Retry de red

`withRetry()` intenta hasta 3 veces con delays `[500ms, 1500ms]`. Solo reintenta errores de red transitorios (`ETIMEDOUT`, `ECONNRESET`, etc.) o HTTP 408/429/502/503/504. Otros errores propagan inmediatamente.

### Resolución de `flow_ns`

```
send_content del agente → ctx.selectedVariants[slug_id]        (stage actual)
send_content de macro    → stageFlowsBySlug[lookup_stage][slug_id]  (stage explícito o destino)
```

---

## Código completo (copy-paste exacto del workflow)

```javascript
// ============================================================================
// ROUTER v4.5 — timeout callManychatFlow/callManychatText: 15 000 ms → 30 000 ms.
// ============================================================================

const TRANSITION_MACROS = {
  'A->MS': {
    after: [
      { type: 'send_content', slug_id: 'QC_MS_AUDIO_se envia antes de la vsl',     evidence: 'auto: cascada A->MS' },
      { type: 'send_content', slug_id: 'QC_MS_VIDEO_vsl que demuestra resultados', evidence: 'auto: cascada A->MS' },
      { type: 'change_stage', new_stage: 'B',                                       evidence: 'auto: contenido core entregado tras 👍 al hook' }
    ]
  },
  'MS->B': {
    lookup_stage: 'MS',
    after: [
      { type: 'send_content', slug_id: 'QC_MS_AUDIO_se envia antes de la vsl',     evidence: 'auto: cascada MS->B' },
      { type: 'send_content', slug_id: 'QC_MS_VIDEO_vsl que demuestra resultados', evidence: 'auto: cascada MS->B' }
    ]
  },
  'B->C': {
    after: [
      { type: 'reply_text_with_link', source_url: 'calendly_url', fallback_text: 'Aquí tienes, elige el horario que te venga: {link}' }
    ]
  },
  'A->disqualified':  { after: [ { type: 'reply_text_dynamic', fallback_text: 'Vale, no es tu momento. Éxitos.' } ] },
  'MS->disqualified': { after: [ { type: 'reply_text_dynamic', fallback_text: 'Vale, no es tu momento. Éxitos.' } ] },
  'B->disqualified':  { after: [ { type: 'reply_text_dynamic', fallback_text: 'Vale, no es tu momento. Éxitos.' } ] },
  'C->disqualified':  { after: [ { type: 'reply_text_dynamic', fallback_text: 'Vale, no es tu momento. Éxitos.' } ] }
};

// ---------- 1. Leer inputs --------------------------------------------------

const ctx = $('Build Context').first().json;
const agentOutput = $input.first().json;
const plan = (agentOutput && agentOutput.output) ? agentOutput.output : agentOutput;

const reasoning = plan.reasoning || '';
const agentActions = Array.isArray(plan.actions) ? plan.actions.slice() : [];

const trace = [];
let firstSentInsertPayload = null;
let currentStage = ctx.currentStage;

const stageFlowsBySlug = ctx.stageFlowsBySlug || {};

const tenantUrls = {
  calendly_url: (ctx.contextJson && ctx.contextJson.extras && ctx.contextJson.extras.calendly_url) || null
};

// ---------- 2. Helpers HTTP -------------------------------------------------

function isRetryableNetworkError(err) {
  if (!err) return false;
  const code = err.code || (err.cause && err.cause.code);
  const msg = String(err.message || err);
  const retryableCodes = ['ETIMEDOUT', 'ECONNABORTED', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE'];
  if (code && retryableCodes.includes(code)) return true;
  return retryableCodes.some(c => msg.includes(c));
}

function isRetryableHttpStatus(statusCode) {
  return [408, 429, 502, 503, 504].includes(statusCode);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry(fn, label) {
  const delays = [500, 1500];
  let lastErr = null;
  let lastResponse = null;

  for (let attempt = 1; attempt <= delays.length + 1; attempt++) {
    try {
      const response = await fn();
      if (response && isRetryableHttpStatus(response.statusCode)) {
        lastResponse = response;
        if (attempt <= delays.length) { await sleep(delays[attempt - 1]); continue; }
        return { response, attempts: attempt, retried: attempt > 1 };
      }
      return { response, attempts: attempt, retried: attempt > 1 };
    } catch (err) {
      lastErr = err;
      const shouldRetry = isRetryableNetworkError(err) && attempt <= delays.length;
      if (!shouldRetry) {
        err.__attempts = attempt;
        err.__retried = attempt > 1;
        throw err;
      }
      await sleep(delays[attempt - 1]);
    }
  }
  if (lastErr) {
    lastErr.__attempts = delays.length + 1;
    lastErr.__retried = true;
    throw lastErr;
  }
  return { response: lastResponse, attempts: delays.length + 1, retried: true };
}

async function callManychatFlow(flowNs) {
  const result = await withRetry(
    () => this.helpers.httpRequest({
      method: 'POST',
      url: 'https://api.manychat.com/fb/sending/sendFlow',
      headers: { Authorization: `Bearer ${ctx.mcApiKey}`, 'Content-Type': 'application/json' },
      body: { subscriber_id: ctx.subscriberId, flow_ns: flowNs },
      json: true, returnFullResponse: true, timeout: 30000
    }),
    `sendFlow(${flowNs})`
  );
  if (result.response) { result.response.__attempts = result.attempts; result.response.__retried = result.retried; }
  return result.response;
}

async function callManychatText(text) {
  const result = await withRetry(
    () => this.helpers.httpRequest({
      method: 'POST',
      url: 'https://api.manychat.com/fb/sending/sendContent',
      headers: { Authorization: `Bearer ${ctx.mcApiKey}`, 'Content-Type': 'application/json' },
      body: {
        subscriber_id: ctx.subscriberId,
        data: { version: 'v2', content: { type: 'instagram', messages: [{ type: 'text', text }] } }
      },
      json: true, returnFullResponse: true, timeout: 30000
    }),
    `sendContent(text)`
  );
  if (result.response) { result.response.__attempts = result.attempts; result.response.__retried = result.retried; }
  return result.response;
}

async function callSetStage(newStage, reason, evidence) {
  const baseUrl = ctx.callbackUrl.replace('/turn-completed', '');
  return await this.helpers.httpRequest({
    method: 'POST',
    url: `${baseUrl}/leads/${ctx.subscriberDbId}/stage`,
    headers: { Authorization: `Bearer ${ctx.callbackToken}`, 'Content-Type': 'application/json' },
    body: { new_stage: newStage, reason: reason || 'no reason provided', evidence: evidence || 'no evidence provided', turn_id: ctx.turnId },
    json: true, returnFullResponse: true
  });
}

// ---------- 3. Resolución de flow_ns ----------------------------------------

function resolveFlowNs(slugId, fromMacro, macroToStage) {
  if (!slugId) return null;
  if (!fromMacro) return (ctx.selectedVariants || {})[slugId] || null;
  const flowsOfStage = stageFlowsBySlug[macroToStage] || {};
  return flowsOfStage[slugId] || null;
}

// ---------- 4. Ejecutores ---------------------------------------------------

async function execSendContent(action, fromMacro, macroToStage) {
  const slugId = action.slug_id || null;
  const directFlowNs = action.flow_ns || null;
  let flowNs = directFlowNs || resolveFlowNs(slugId, fromMacro, macroToStage);

  if (!flowNs) {
    const availableSlugs = fromMacro
      ? Object.keys(stageFlowsBySlug[macroToStage] || {})
      : Object.keys(ctx.selectedVariants || {});
    return { type: 'send_content', status: 'error', reason: `No se encontró flow_ns para slug_id="${slugId}" en stage="${fromMacro ? macroToStage : currentStage}"`, slug_id: slugId, lookup_stage: fromMacro ? macroToStage : currentStage, available_slugs: availableSlugs };
  }

  try {
    const res = await callManychatFlow.call(this, flowNs);
    const ok = res.statusCode === 200 && res.body && res.body.status === 'success';
    if (!ok) return { type: 'send_content', status: 'error', slug_id: slugId, flow_ns: flowNs, status_code: res.statusCode, api_response: res.body, attempts: res.__attempts, retried: res.__retried, reason: `ManyChat ${res.statusCode}: ${JSON.stringify(res.body)}` };
    if (!firstSentInsertPayload) {
      firstSentInsertPayload = { tenant_id: ctx.tenantDbId, subscriber_id: ctx.subscriberDbId, conversation_id: ctx.conversationId, stage_slug: currentStage, slug_id: slugId, flow_ns: flowNs, turn_id: ctx.turnId };
    }
    return { type: 'send_content', status: 'sent', slug_id: slugId, flow_ns: flowNs, evidence: action.evidence, attempts: res.__attempts, retried: res.__retried };
  } catch (err) {
    return { type: 'send_content', status: 'error', slug_id: slugId, flow_ns: flowNs, reason: err.message || String(err), api_response: err.response ? err.response.body : null, attempts: err.__attempts || 1, retried: err.__retried || false, exhausted: true };
  }
}

async function execChangeStage(action) {
  if (!action.new_stage) return { type: 'change_stage', status: 'error', reason: 'missing new_stage' };
  try {
    const res = await callSetStage.call(this, action.new_stage, action.reason, action.evidence);
    const ok = res.statusCode === 200;
    if (!ok) return { type: 'change_stage', status: 'error', from_stage: currentStage, new_stage: action.new_stage, reason: action.reason, evidence: action.evidence, status_code: res.statusCode, api_response: res.body };
    const fromStage = currentStage;
    currentStage = action.new_stage;
    return { type: 'change_stage', status: 'changed', from_stage: fromStage, new_stage: action.new_stage, reason: action.reason, evidence: action.evidence, api_response: res.body };
  } catch (err) {
    return { type: 'change_stage', status: 'error', from_stage: currentStage, new_stage: action.new_stage, reason: err.message || String(err) };
  }
}

async function execReplyText(action) {
  const text = (action.text || '').trim();
  if (!text) return { type: 'reply_text', status: 'skipped', reason: 'empty text' };
  try {
    const res = await callManychatText.call(this, text);
    const ok = res.statusCode === 200 && res.body && res.body.status === 'success';
    return { type: 'reply_text', status: ok ? 'sent' : 'error', text, api_response: ok ? null : res.body, attempts: res.__attempts, retried: res.__retried };
  } catch (err) {
    return { type: 'reply_text', status: 'error', text, reason: err.message || String(err), api_response: err.response ? err.response.body : null, attempts: 3, retried: true, exhausted: true };
  }
}

async function execReplyTextWithLink(action) {
  const url = tenantUrls[action.source_url];
  if (!url) return { type: 'reply_text_with_link', status: 'error', reason: `Falta URL: tenantUrls["${action.source_url}"] está vacía.` };
  const leadIn = (action.__lead_in || '').trim();
  let text;
  if (leadIn) {
    text = leadIn.includes(url) ? leadIn : `${leadIn} ${url}`;
  } else {
    text = (action.fallback_text || '{link}').replace('{link}', url);
  }
  return await execReplyText.call(this, { text });
}

async function execReplyTextDynamic(action) {
  const leadIn = (action.__lead_in || '').trim();
  const text = leadIn || action.fallback_text || '';
  if (!text) return { type: 'reply_text_dynamic', status: 'error', reason: 'no lead_in y no fallback_text' };
  return await execReplyText.call(this, { text });
}

async function execAction(action, fromMacro, macroToStage) {
  switch (action.type) {
    case 'send_content':         return await execSendContent.call(this, action, fromMacro, macroToStage);
    case 'change_stage':         return await execChangeStage.call(this, action);
    case 'reply_text':           return await execReplyText.call(this, action);
    case 'reply_text_with_link': return await execReplyTextWithLink.call(this, action);
    case 'reply_text_dynamic':   return await execReplyTextDynamic.call(this, action);
    default: return { type: action.type || 'unknown', status: 'error', reason: 'unsupported action type' };
  }
}

// ---------- 5. Bucle principal ---------------------------------------------

let step = 0;
function pushTrace(action, result, source) {
  step++;
  trace.push({ step, action, result, source });
}

async function runMacro(transitionKey, toStage, leadInFromAgent) {
  const macro = TRANSITION_MACROS[transitionKey];
  if (!macro || !Array.isArray(macro.after)) return;

  const stageForLookup = macro.lookup_stage || toStage;

  for (const macroActionTemplate of macro.after) {
    const macroAction = { ...macroActionTemplate, __lead_in: leadInFromAgent || null };
    const result = await execAction.call(this, macroAction, true, stageForLookup);
    pushTrace(macroAction, result, `macro:${transitionKey}`);

    const isOk =
      (macroAction.type === 'send_content'         && result.status === 'sent')    ||
      (macroAction.type === 'change_stage'         && result.status === 'changed') ||
      (macroAction.type === 'reply_text'           && result.status === 'sent')    ||
      (macroAction.type === 'reply_text_with_link' && result.status === 'sent')    ||
      (macroAction.type === 'reply_text_dynamic'   && result.status === 'sent');

    if (!isOk) {
      const errorDetail = JSON.stringify({ transition: transitionKey, failed_action: macroAction, result, trace_so_far: trace }, null, 2);
      throw new Error(
        `[Router v4.4] Macro "${transitionKey}" falló en la acción ${macroAction.type}` +
        (macroAction.slug_id ? ` (slug_id="${macroAction.slug_id}")` : '') +
        `. El workflow se detiene para no avanzar el estado del lead silenciosamente.\n\nDetalle:\n${errorDetail}`
      );
    }
  }
}

let agentTriggeredMacro = false;
for (const action of agentActions) {
  const result = await execAction.call(this, action, false, null);
  pushTrace(action, result, 'agent');

  if (action.type === 'change_stage' && result.status === 'changed' && !agentTriggeredMacro) {
    const key = `${result.from_stage}->${result.new_stage}`;
    if (TRANSITION_MACROS[key]) {
      agentTriggeredMacro = true;
      await runMacro.call(this, key, result.new_stage, action.lead_in);
    }
  }
}

// ---------- 6. Output -------------------------------------------------------

return [{
  json: JSON.parse(JSON.stringify({
    plan: { reasoning, actions: agentActions },
    trace: trace,
    insert_content_sent: firstSentInsertPayload,
    subscriberDbId: ctx.subscriberDbId,
    conversationId: ctx.conversationId,
    turnId: ctx.turnId,
    callbackUrl: ctx.callbackUrl,
    callbackToken: ctx.callbackToken,
    finalStage: currentStage
  }))
}];
```

---

## Output del Router

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `plan` | object | El plan del agente: `{ reasoning, actions }` |
| `trace` | array | Ejecución paso a paso — cada item tiene `{ step, action, result, source }`. `source` es `'agent'` o `'macro:<key>'` |
| `insert_content_sent` | object\|null | Payload para INSERT en `lead_content_sent`. Solo el primer `send_content` exitoso del turno |
| `subscriberDbId` | UUID | Para nodos downstream |
| `conversationId` | UUID | Para nodos downstream |
| `turnId` | UUID | Para nodos downstream |
| `callbackUrl` | string | Para nodos downstream |
| `callbackToken` | string | Para nodos downstream |
| `finalStage` | string | Stage al terminar el turno (puede diferir del inicial si hubo `change_stage`) |

---

## Flujo completo con cascada A→MS

```
agentActions = [{ type: 'change_stage', new_stage: 'MS', evidence: '👍' }]

1. execChangeStage(MS)   → API /admin/leads/.../stage  → 200 OK  [source: agent]
2. detecta macro 'A->MS'
3. runMacro('A->MS', 'MS', undefined):
   3.1 send_content(QC_MS_AUDIO_...)  → sendFlow → 200  [source: macro:A->MS]
   3.2 send_content(QC_MS_VIDEO_...)  → sendFlow → 200  [source: macro:A->MS]
   3.3 change_stage(B)               → API /stage → 200  [source: macro:A->MS]
4. finalStage = 'B'
```

---

## Transiciones disponibles (definidas en el API)

```
A  → MS | disqualified
MS → B  | disqualified
B  → C  | disqualified
C  → D  | disqualified
D  → (ninguna)
disqualified → (ninguna)
```

Transición inválida → `400 INVALID_TRANSITION` desde el API.

---

## Fail-loud en macros

Si cualquier acción de una macro falla, el Router lanza una excepción que detiene el workflow. Esto es intencional — es preferible que el turno falle ruidosamente a que el estado del lead avance sin que se haya enviado el contenido correspondiente.
