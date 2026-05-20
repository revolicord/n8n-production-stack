# Nodo: Router v1

**Tipo:** Code (JavaScript)  
**Posición en cadena:** Después de `AI Agent`, antes de nodos de INSERT y Callback  
**Propósito:** Ejecutar el plan emitido por el AI Agent — enviar flow de ManyChat (`send_content`), cambiar etapa del lead (`change_stage`) y/o responder texto libre (`reply_text`).

---

## Estado del código en el workflow vivo

> El código que aparece en la sección "Código completo" abajo es el **estado canónico correcto** (bugs aplicados).  
> El JSON exportado `agent-run(5).json` tiene los bugs 3 y 5 **aún sin aplicar** — ver tabla.

## Historial de correcciones

| # | Estado en vivo | Problema | Causa | Fix |
|---|---------------|----------|-------|-----|
| 1 | ✅ aplicado | **404 / UUID inválido** en `change_stage` | `ctx.subscriberId` es el ID numérico de ManyChat; la ruta `/admin/leads/:id/stage` espera el UUID de la DB | Cambiar a `ctx.subscriberDbId` |
| 2 | ✅ aplicado | **400 INVALID_PAYLOAD** en `change_stage` | `reason` o `evidence` pueden llegar `undefined`; el schema Zod requiere `string.min(1)` | Agregar fallback `|| 'no reason provided'` / `|| 'no evidence provided'` |
| 3 | ✅ aplicado | **404 de ManyChat** en `send_content` | El agente emite el `human_name` del flow (`QC_MS_AUDIO_…`) en lugar del `flow_ns` real. El nodo acepta **`flow_ns` directo** en `sendContent.flow_ns` y lo usa sin lookup. Si viene `slug_id`, hace el lookup legacy en `selectedVariants`. | Ver sección `send_content` |
| 4 | ✅ aplicado | **Errores opacos** — no se veía qué `flow_ns` se enviaba | Sin contexto en el objeto de error | Agregar `slug_id`, `flow_ns`, `available_slugs`, `status_code`, `api_response` en todos los paths de error |
| 5 | ⚠️ **PENDIENTE** | **400 en `reply_text`** (`sendContent`) — `message_tag: "ACCOUNT_UPDATE"` aún presente en el JSON vivo | ManyChat retorna 400 cuando el tag no está permitido para el canal o la conversación está dentro de la ventana de 24h | Quitar `message_tag`; agregar `actions: []` y `quick_replies: []` al content |
| 6 | ⚠️ **PENDIENTE** | **Turn lock nunca liberado** — no existe nodo turn-completed al final del workflow | Falta HTTP Request que llame `POST callbackUrl` al finalizar | Añadir nodo HTTP Request al final de todas las ramas |

---

## Código completo (copy-paste)

```javascript
// ============================================================================
// ROUTER v1 — ejecuta el plan emitido por el AI Agent.
// ============================================================================
// send_content acepta dos formatos:
//   { flow_ns: "content20260511…", evidence: "…" }   ← directo (preferido, igual que nodo HTTP)
//   { slug_id: "QC_MS_…",          evidence: "…" }   ← legacy, hace lookup en selectedVariants
// ============================================================================

// ---------- 1. Leer inputs --------------------------------------------------

const ctx = $('Build Context').first().json;

const agentOutput = $input.first().json;
const plan = (agentOutput && agentOutput.output) ? agentOutput.output : agentOutput;

const reasoning   = plan.reasoning    || '';
const sendContent = plan.send_content || null;
const changeStage = plan.change_stage || null;
const replyText   = plan.reply_text   || null;

const results = {
  reasoning:    reasoning,
  send_content: null,
  change_stage: null,
  reply_text:   null
};

// ---------- 2. Helpers HTTP -------------------------------------------------

async function callManychatFlow(flowNs) {
  return await this.helpers.httpRequest({
    method: 'POST',
    url: 'https://api.manychat.com/fb/sending/sendFlow',
    headers: {
      Authorization: `Bearer ${ctx.mcApiKey}`,
      'Content-Type': 'application/json'
    },
    body: { subscriber_id: ctx.subscriberId, flow_ns: flowNs },
    json: true,
    returnFullResponse: true
  });
}

async function callManychatText(text) {
  return await this.helpers.httpRequest({
    method: 'POST',
    url: 'https://api.manychat.com/fb/sending/sendContent',
    headers: {
      Authorization: `Bearer ${ctx.mcApiKey}`,
      'Content-Type': 'application/json'
    },
    body: {
      subscriber_id: ctx.subscriberId,
      data: {
        version: 'v2',
        content: {
          type: 'instagram',
          messages: [{ type: 'text', text: text }]
        }
      }
    },
    json: true,
    returnFullResponse: true
  });
}

async function callSetStage(newStage, reason, evidence) {
  const baseUrl = ctx.callbackUrl.replace('/turn-completed', '');
  return await this.helpers.httpRequest({
    method: 'POST',
    url: `${baseUrl}/leads/${ctx.subscriberDbId}/stage`,
    headers: {
      Authorization: `Bearer ${ctx.callbackToken}`,
      'Content-Type': 'application/json'
    },
    body: {
      new_stage: newStage,
      reason:    reason   || 'no reason provided',
      evidence:  evidence || 'no evidence provided',
      turn_id:   ctx.turnId
    },
    json: true,
    returnFullResponse: true
  });
}

// ---------- 3. send_content -------------------------------------------------

if (sendContent) {
  // Formato directo (preferido): el agente emite flow_ns exacto
  // Formato legacy:              el agente emite slug_id → lookup en selectedVariants
  let flowNs = sendContent.flow_ns || null;
  const slugId = sendContent.slug_id || null;

  if (!flowNs && slugId) {
    flowNs = (ctx.selectedVariants || {})[slugId];
  }

  if (!flowNs) {
    results.send_content = {
      status:           'error',
      reason:           `No se encontró flow_ns. slug_id="${slugId}" flow_ns_directo="${sendContent.flow_ns}"`,
      slug_id:          slugId,
      available_slugs:  Object.keys(ctx.selectedVariants || {})
    };
  } else {
    try {
      const res = await callManychatFlow.call(this, flowNs);
      const ok = res.statusCode === 200 && res.body && res.body.status === 'success';

      results.send_content = ok
        ? {
            status:   'sent',
            slug_id:  slugId,
            flow_ns:  flowNs,
            evidence: sendContent.evidence,
            insert_payload: {
              tenant_id:       ctx.tenantDbId,
              subscriber_id:   ctx.subscriberDbId,
              conversation_id: ctx.conversationId,
              stage_slug:      ctx.currentStage,
              slug_id:         slugId,
              flow_ns:         flowNs,
              turn_id:         ctx.turnId
            }
          }
        : {
            status:       'error',
            slug_id:      slugId,
            flow_ns:      flowNs,
            status_code:  res.statusCode,
            api_response: res.body,
            reason:       `ManyChat ${res.statusCode}: ${JSON.stringify(res.body)}`
          };
    } catch (err) {
      results.send_content = {
        status:       'error',
        slug_id:      slugId,
        flow_ns:      flowNs,
        reason:       err.message || String(err),
        api_response: err.response ? err.response.body : null
      };
    }
  }
}

// ---------- 4. change_stage -------------------------------------------------

if (changeStage && changeStage.new_stage) {
  try {
    const res = await callSetStage.call(
      this,
      changeStage.new_stage,
      changeStage.reason,
      changeStage.evidence
    );
    const ok = res.statusCode === 200;
    results.change_stage = {
      status:       ok ? 'changed' : 'error',
      new_stage:    changeStage.new_stage,
      reason:       changeStage.reason,
      evidence:     changeStage.evidence,
      api_response: res.body
    };
  } catch (err) {
    results.change_stage = { status: 'error', reason: err.message || String(err) };
  }
}

// ---------- 5. reply_text ---------------------------------------------------

if (replyText && typeof replyText === 'string' && replyText.trim().length > 0) {
  try {
    const res = await callManychatText.call(this, replyText.trim());
    const ok = res.statusCode === 200 && res.body && res.body.status === 'success';
    results.reply_text = {
      status:       ok ? 'sent' : 'error',
      text:         replyText.trim(),
      api_response: ok ? null : res.body
    };
  } catch (err) {
    results.reply_text = {
      status:       'error',
      reason:       err.message || String(err),
      api_response: err.response ? err.response.body : null
    };
  }
}

// ---------- 6. Output -------------------------------------------------------

return [{
  json: {
    plan:    plan,
    results: results,

    insert_content_sent: results.send_content && results.send_content.status === 'sent'
      ? results.send_content.insert_payload
      : null,

    subscriberDbId: ctx.subscriberDbId,
    conversationId: ctx.conversationId,
    turnId:         ctx.turnId,
    callbackUrl:    ctx.callbackUrl,
    callbackToken:  ctx.callbackToken
  }
}];
```

---

## Por qué dos formatos para `send_content`

El nodo HTTP de n8n usa `$fromAI('flow_id', …)` — el agente emite el `flow_ns` real (ej. `content20260511153207_699341`) directamente en el campo. El código replica eso:

```json
{ "flow_ns": "content20260511153207_699341", "evidence": "…" }
```

El formato legacy con `slug_id` requiere que Build Context exporte `selectedVariants` con el mapeo `human_name → flow_ns`. Si ese mapeo no está en el output de Build Context, el lookup siempre falla. **Usar `flow_ns` directo elimina esa dependencia.**

Para que el agente emita `flow_ns` y no `slug_id`, el prompt en Build Context ya le pide que copie el valor exacto:
```
→ flow_name (cópialo EXACTO, carácter por carácter):
  content20260511153207_699341
```

Si el agente igual alucina un nombre legible (`QC_MS_AUDIO_…`), revisar el prompt o agregar `selectedVariants` al output de Build Context.

---

## Transiciones válidas (`change_stage`)

```
A  → MS | disqualified
MS → B  | disqualified
B  → C  | disqualified
C  → D  | disqualified
D  → (ninguna)
disqualified → (ninguna)
```

Definidas en `apps/api/src/routes/admin/set-stage.ts:24`. Transición inválida → `400 INVALID_TRANSITION` registrado en `results.change_stage.api_response`.

---

## Campos requeridos en `change_stage`

```json
{
  "change_stage": {
    "new_stage": "MS",
    "reason": "lead confirmó interés explícito",
    "evidence": "Mensaje: 'sí quiero saber más'"
  }
}
```

`reason` y `evidence` son obligatorios (`string min(1)`). El nodo usa fallback `'no reason provided'` si llegan vacíos, pero el dato queda sin contexto útil en DB.
