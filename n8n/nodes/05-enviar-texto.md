# Nodo: enviar texto ⚠️ DEPRECADO — eliminado en v3+

> **Este nodo ya no existe en el workflow `agent-run`.** Fue eliminado cuando el AI Agent migró de herramientas a Structured Output Parser (v3). El envío de texto ahora ocurre dentro del **Router** vía `callManychatText()` para acciones `reply_text`.

---

## Contexto histórico (v1 / v2)

En las versiones anteriores, el AI Agent tenía una herramienta `trigger_manychat_flow` y el output del agente era texto libre. Este nodo HTTP Request enviaba ese texto al lead vía `sendContent`.

**Flujo antiguo (v1/v2):**
```
AI Agent → enviar texto (HTTP sendContent) → Prepare Callback → Callback
```

**Flujo actual (v3+):**
```
AI Agent → Router (ejecuta acciones: sendFlow, sendContent, set-stage) → If → ... → Callback
```

---

## Migración

Si necesitas enviar texto al lead, el Router lo hace con:

```javascript
async function callManychatText(text) {
  return await this.helpers.httpRequest({
    method: 'POST',
    url: 'https://api.manychat.com/fb/sending/sendContent',
    headers: { Authorization: `Bearer ${ctx.mcApiKey}`, 'Content-Type': 'application/json' },
    body: {
      subscriber_id: ctx.subscriberId,
      data: { version: 'v2', content: { type: 'instagram', messages: [{ type: 'text', text }] } }
    },
    json: true,
    returnFullResponse: true
  });
}
```

Ver `08-router-v1.md` para la implementación completa.
