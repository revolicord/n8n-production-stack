# Nodo: Build Context

**Tipo:** Code (JavaScript)  
**Posición en cadena:** 1 (después de Webhook)  
**Propósito:** Normalizar el payload entrante, filtrar flows permitidos por etapa y construir el system prompt dinámico.

---

## Código completo (copy-paste)

```javascript
const raw = $('Webhook').first().json;
const body = raw.body ?? raw;

// Mensajes del turno actual
const messages = body.messages
  .map(m => {
    if (m.reply_type === 'thumbs_up') return '👍 [el contacto envió pulgar arriba]';
    if (m.media_urls && m.media_urls.length > 0 && !m.text) return `[${m.reply_type ?? 'media'} recibido]`;
    return m.text ?? '[mensaje sin texto]';
  })
  .filter(Boolean)
  .join('\n');

const subscriberName = body.subscriber.display_name
  || body.subscriber.ig_username || 'Usuario';

// Etapa actual del lead (viene del API vía lead_stages)
const currentStage = body.lead_stage ?? body.subscriber.metadata?.stage ?? 'nuevo';

// Flows permitidos para esta etapa (viene de tenants.config.flows_by_stage)
const flowsByStage = body.tenant?.config?.flows_by_stage ?? {};
const allowedFlows = flowsByStage[currentStage] ?? [];

// flow_name = ns de ManyChat (el LLM usa el ns directamente, evita lookups en n8n)
const flowsSection = allowedFlows.length > 0
  ? '\n\nContenido disponible para esta etapa. Usa trigger_manychat_flow con el flow_name exacto:\n'
    + allowedFlows.map(f => `- flow_name: "${f.ns}" — ${f.description}`).join('\n')
  : '';

return [{
  json: {
    chatInput: messages,
    systemPrompt: `Eres un asistente de ventas amable de Revolicord. Responde siempre en el idioma del usuario. Sé conciso y cálido, máximo 2-3 oraciones. Sin markdown. El usuario se llama ${subscriberName}. Etapa actual: ${currentStage}.${flowsSection}`,
    subscriberId: body.subscriber.manychat_subscriber_id,
    subscriberDbId: body.subscriber.id,
    currentStage: body.subscriber.lead_stage ?? 'nuevo',
    mcApiKey: body.tenant?.config?.manychat_api_key || '',
    conversationId: body.conversation.id,
    turnId: body.turn_id,
    subscriberDbId: body.subscriber.id,
    currentStage,
    callbackUrl: body.callback_url,
    callbackToken: body.callback_token
  }
}];
```

---

## Notas

- `lead_stage` viene del API como campo de primer nivel en el payload (tabla `lead_stages`). Si no existe, cae al fallback `subscriber.metadata.stage` para compatibilidad hacia atrás.
- `flows_by_stage` es un JSON dentro de `tenants.config`. Ver `stages.md` para el formato esperado.
- `subscriberDbId` se pasa para que la tool `set_stage` pueda hacer el POST al API sin necesidad de un lookup adicional.
- El `systemPrompt` es la única fuente de contexto para el LLM — no se usan tool definitions para listar flows (ver ADR-0008 Pilar 2).
