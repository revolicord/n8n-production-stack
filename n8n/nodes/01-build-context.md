# Nodo: Build Context

**Tipo:** Code (JavaScript)
**Posición en cadena:** 1 (después de Webhook)
**Propósito:** Normalizar el payload entrante, cargar el system prompt del tenant, filtrar los flows permitidos por etapa y construir el prompt final con el bloque `# CONTEXTO` dinámico.

---

## Código completo (copy-paste)

```javascript
const raw = $('Webhook').first().json;
const body = raw.body ?? raw;

// --- Mensajes del turno actual ---
const messages = body.messages
  .map(m => {
    if (m.reply_type === 'thumbs_up') return '👍 [el contacto reaccionó con pulgar arriba]';
    if (m.media_urls?.length > 0 && !m.text) return `[contenido multimedia recibido — no se puede leer]`;
    return m.text ?? '[mensaje sin texto]';
  })
  .filter(Boolean)
  .join('\n');

// --- Datos del lead ---
const sub = body.subscriber;
const subscriberName = sub.display_name || sub.ig_username || 'la persona';
// Etapa actual: A | MS | B | C | D | disqualified | lost | escalated_human_call
const currentStage = sub.lead_stage ?? sub.metadata?.stage ?? 'A';

// --- Presencia (heurística adaptativa de Media Seen, ver docs-dm-settings/13) ---
// PENDIENTE: el API aún no envía instagram_context — ver SETTER-MVP-TRACKING.md P1
const igCtx = body.instagram_context ?? {};
const lastSeen = igCtx.last_seen ?? null;
const lastInteraction = igCtx.last_interaction ?? null;

// --- Señales detectadas por el agente en turnos anteriores ---
const signals = sub.metadata?.signals ?? body.lead_state?.signals ?? null;

// --- Flows permitidos para esta etapa (de tenants.config.flows_by_stage) ---
const flowsByStage = body.tenant?.config?.flows_by_stage ?? {};
const allowedFlows = flowsByStage[currentStage] ?? [];
// flow_name = ns de ManyChat (el LLM usa el ns directamente, sin lookup en n8n)
const flowsSection = allowedFlows.length > 0
  ? allowedFlows.map(f => `- flow_name: "${f.ns}" — ${f.description}`).join('\n')
  : '(no hay contenido nuevo para enviar en esta etapa)';

// --- Link de Calendly (para etapa B→C) ---
const calendlyUrl = body.tenant?.config?.calendly_url ?? body.lead_state?.calendly_url ?? '';

// --- Prompt estático: vive en tenants.config.system_prompt (fuente: n8n/prompts/setter-v1.md) ---
const staticPrompt = body.tenant?.config?.system_prompt ?? '';

// --- Bloque de contexto dinámico que se anexa al prompt estático ---
const contextLines = [
  `La persona se llama: ${subscriberName}`,
  `Etapa actual del lead: ${currentStage}`,
];
if (lastSeen) contextLines.push(`Última vez activa en Instagram: ${lastSeen}`);
if (lastInteraction) contextLines.push(`Última interacción contigo: ${lastInteraction}`);
if (signals) contextLines.push(`Señales detectadas en turnos anteriores: ${typeof signals === 'string' ? signals : JSON.stringify(signals)}`);
if (calendlyUrl) contextLines.push(`Link de Calendly para enviar en etapa B→C: ${calendlyUrl}`);
contextLines.push('');
contextLines.push('CONTENIDO DISPONIBLE para esta etapa (usa trigger_manychat_flow con el flow_name exacto):');
contextLines.push(flowsSection);
const dynamicContext = contextLines.join('\n');

// --- Prompt final ---
const systemPrompt = staticPrompt
  ? `${staticPrompt}\n\n# CONTEXTO\n${dynamicContext}`
  // Fallback mínimo si el tenant aún no tiene system_prompt configurado
  : `Eres Alex, el setter de Quantum Creators por Instagram DM. Sé cálido y breve, máximo 2 frases, tutea siempre. Nunca digas que eres un bot ni des precios.\n\n# CONTEXTO\n${dynamicContext}`;

return [{
  json: {
    chatInput: messages,
    systemPrompt,
    subscriberId: sub.manychat_subscriber_id,
    subscriberDbId: sub.id,
    mcApiKey: body.tenant?.config?.manychat_api_key || '',
    conversationId: body.conversation.id,
    turnId: body.turn_id,
    currentStage,
    callbackUrl: body.callback_url,
    callbackToken: body.callback_token
  }
}];
```

---

## Notas

- **El prompt estático** se lee de `tenants.config.system_prompt`. La fuente versionada es `n8n/prompts/setter-v1.md`; cuando se edite el prompt allí, hay que copiarlo a la config del tenant.
- **`currentStage`** usa el modelo `A | MS | B | C | D | disqualified | lost | escalated_human_call` (ver `stages.md`). El fallback por defecto es `'A'` (lead nuevo).
- **`flows_by_stage`** es un JSON dentro de `tenants.config`. Las claves son las siglas de etapa. Ver `stages.md` y `flows-catalog.md`.
- **`subscriberDbId`** se pasa para que la tool `set_stage` haga el POST al API sin un lookup adicional.
- **Variables pendientes** (`instagram_context`, `signals`): el código ya las consume pero el payload del API aún no las envía — ver `SETTER-MVP-TRACKING.md` P1. Hasta entonces, el bloque `# CONTEXTO` simplemente las omite.
- El `systemPrompt` es la única fuente de contexto para el LLM — no se usan tool definitions para listar flows (ver ADR-0008 Pilar 2).
