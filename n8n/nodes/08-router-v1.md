# Nodo: Router v1

**Tipo:** Code (JavaScript)  
**Posición en cadena:** Después de `AI Agent`, antes de nodos de INSERT y Callback  
**Propósito:** Ejecutar el plan emitido por el AI Agent — enviar flow de ManyChat (`send_content`), cambiar etapa del lead (`change_stage`) y/o responder texto libre (`reply_text`).

---

## Bugs corregidos (vs. versión original)

| # | Problema | Causa | Fix |
|---|----------|-------|-----|
| 1 | **400 de ManyChat** en `send_content` / `reply_text` | Endpoints `/fb/` usados en lugar de `/ig/` — el sistema es Instagram DM | Cambiar a `/ig/sending/sendFlow` e `/ig/sending/sendContent` |
| 2 | **404 / UUID inválido** en `change_stage` | `ctx.subscriberId` es el ID numérico de ManyChat; la ruta `/admin/leads/:id/stage` espera el UUID de la DB | Cambiar a `ctx.subscriberDbId` |
| 3 | **400 INVALID_PAYLOAD** en `change_stage` | `reason` o `evidence` pueden llegar `undefined` desde el AI Agent; el schema Zod requiere `string.min(1)` | Agregar fallback `|| 'no reason provided'` / `|| 'no evidence provided'` |

---

## Código completo (copy-paste)

```javascript
// ============================================================================
// ROUTER v1 — ejecuta el plan emitido por el AI Agent.
// ============================================================================
// Lee:
//   - El plan del AI Agent (output con reasoning, send_content, change_stage, reply_text)
//   - Build Context (selectedVariants, IDs, tokens, etc.)
// Ejecuta:
//   1. send_content -> POST ManyChat ig/sending/sendFlow + prepara INSERT lead_content_sent
//   2. change_stage -> POST /admin/leads/:subscriberDbId/stage
//   3. reply_text   -> POST ManyChat ig/sending/sendContent (texto)
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
    url: 'https://api.manychat.com/ig/sending/sendFlow',
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
    url: 'https://api.manychat.com/ig/sending/sendContent',
    headers: {
      Authorization: `Bearer ${ctx.mcApiKey}`,
      'Content-Type': 'application/json'
    },
    body: {
      subscriber_id: ctx.subscriberId,
      data: {
        version: 'v2',
        content: {
          messages: [{ type: 'text', text: text }]
        }
      },
      message_tag: 'ACCOUNT_UPDATE'
    },
    json: true,
    returnFullResponse: true
  });
}

async function callSetStage(newStage, reason, evidence) {
  // Ruta real: POST /admin/leads/:subscriberDbId/stage (UUID de la DB)
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

if (sendContent && sendContent.slug_id) {
  const flowNs = (ctx.selectedVariants || {})[sendContent.slug_id];

  if (!flowNs) {
    results.send_content = {
      status: 'error',
      reason: `slug_id "${sendContent.slug_id}" no existe en selectedVariants`
    };
  } else {
    try {
      const res = await callManychatFlow.call(this, flowNs);
      const ok = res.statusCode === 200 && res.body && res.body.status === 'success';

      results.send_content = ok
        ? {
            status:   'sent',
            slug_id:  sendContent.slug_id,
            flow_ns:  flowNs,
            evidence: sendContent.evidence,
            insert_payload: {
              tenant_id:       ctx.tenantDbId,
              subscriber_id:   ctx.subscriberDbId,
              conversation_id: ctx.conversationId,
              stage_slug:      ctx.currentStage,
              slug_id:         sendContent.slug_id,
              flow_ns:         flowNs,
              turn_id:         ctx.turnId
            }
          }
        : {
            status: 'error',
            reason: `ManyChat ${res.statusCode}: ${JSON.stringify(res.body)}`
          };
    } catch (err) {
      results.send_content = { status: 'error', reason: err.message || String(err) };
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
    results.reply_text = { status: 'error', reason: err.message || String(err) };
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

    subscriberDbId:  ctx.subscriberDbId,
    conversationId:  ctx.conversationId,
    turnId:          ctx.turnId,
    callbackUrl:     ctx.callbackUrl,
    callbackToken:   ctx.callbackToken
  }
}];
```

---

## Transiciones válidas (referencia)

Definidas en `apps/api/src/routes/admin/set-stage.ts:24`:

```
A  → MS | disqualified
MS → B  | disqualified
B  → C  | disqualified
C  → D  | disqualified
D  → (ninguna)
disqualified → (ninguna)
```

Si el AI Agent emite una transición inválida (ej. `A → B`), el API retorna `400 INVALID_TRANSITION`. El nodo registra el error en `results.change_stage.api_response` sin bloquear el resto del turno.

---

## Campos que el AI Agent debe emitir en `change_stage`

```json
{
  "change_stage": {
    "new_stage": "MS",
    "reason": "lead confirmó interés explícito",
    "evidence": "Mensaje: 'sí quiero saber más'"
  }
}
```

`reason` y `evidence` son **obligatorios** (`string`, mínimo 1 carácter). Si el prompt no los exige, el nodo usa fallbacks pero el dato queda sin contexto útil.
