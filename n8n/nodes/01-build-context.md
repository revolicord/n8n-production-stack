# Nodo: Build Context

**Tipo:** Code (JavaScript)
**Posición en cadena:** 1 (después de Webhook, sin nodo "Get Tools")
**Propósito:** Normalizar el payload entrante, seleccionar el flow de ManyChat que corresponde a la etapa actual (un único flow, elegido aquí), y construir el system prompt final con el bloque `# CONTEXTO` dinámico.

> El mapa de flows vive aquí, en este nodo — no en Postgres ni en el payload del API.
> Para cambiar qué flow se envía en cada etapa, editar la constante `FLOW_MAP` de abajo.

---

## Código completo (copy-paste)

```javascript
// ─── MAPA DE FLOWS POR ETAPA ─────────────────────────────────────────────────
// Cada etapa tiene una lista de variantes. Si hay más de una se elige al azar
// (A/B automático). El agente solo ve UN flow_name por turno.
// Para desactivar una variante: comentarla o borrarla del array.
// Para cambiar el flow activo: actualizar el ns aquí.
const FLOW_MAP = {
  // Funnel revolicord (etapas legacy)
  nuevo: [
    'content20260511152354_558165',  // video hook v1
    'content20260511155655_840313',  // video hook v2
    'content20260511160051_518775',  // video hook v3
    'content20260511160458_294557',  // video hook cpchel
  ],
  interesado: [
    'content20260511153207_699341',  // audio intro VSL
  ],
  prospecto: [
    'content20260506163913_313256',  // audio presentación
  ],

  // Funnel Quantum Creators (etapas A/MS/B/C/D) — reemplazar ns cuando estén confirmados
  A:  ['PENDIENTE_ns_video_hook'],   // video de enganche 25 s
  MS: ['PENDIENTE_ns_video_vsl'],    // VSL 1:58
  B:  [],  // el agente manda el link de Calendly por texto, no hay flow
  C:  [],
  D:  [],
};

// Descripción legible para el agente según la etapa (qué debe decirle al lead)
const FLOW_DESC = {
  nuevo:     'Video de enganche de 25 s — envíalo como primer contacto y pide pulgar arriba',
  interesado:'Audio de introducción antes de la VSL — cuando el lead muestra interés real',
  prospecto: 'Audio de presentación completa del producto',
  A:         'Video de enganche de 25 s — primer contacto, pide pulgar arriba',
  MS:        'VSL de 1:58 que explica el sistema completo — enviar cuando confirmó ver el Vídeo 1',
};

function pickFlow(stage) {
  const variants = FLOW_MAP[stage] ?? [];
  if (variants.length === 0) return null;
  return variants[Math.floor(Math.random() * variants.length)];
}
// ─────────────────────────────────────────────────────────────────────────────

const raw = $('Webhook').first().json;
const body = raw.body ?? raw;

// --- Mensajes del turno actual ---
const messages = body.messages
  .map(m => {
    if (m.reply_type === 'thumbs_up') return '👍 [el contacto reaccionó con pulgar arriba]';
    if (m.media_urls?.length > 0 && !m.text) return '[contenido multimedia recibido — no se puede leer]';
    return m.text ?? '[mensaje sin texto]';
  })
  .filter(Boolean)
  .join('\n');

// --- Datos del lead ---
const sub = body.subscriber;
const subscriberName = sub.display_name || sub.ig_username || 'la persona';
const currentStage = sub.lead_stage ?? sub.metadata?.stage ?? 'nuevo';

// --- Presencia (heurística Media Seen — pendiente: API aún no envía esto, ver SETTER-MVP-TRACKING P1) ---
const igCtx = body.instagram_context ?? {};
const lastSeen = igCtx.last_seen ?? null;
const lastInteraction = igCtx.last_interaction ?? null;

// --- Señales detectadas en turnos anteriores ---
const signals = sub.metadata?.signals ?? body.lead_state?.signals ?? null;

// --- Link de Calendly (para etapa B→C) ---
const calendlyUrl = body.tenant?.config?.calendly_url ?? '';

// --- Flow seleccionado para esta etapa (único, ya elegido — el agente no decide cuál) ---
const selectedNs = pickFlow(currentStage);
const flowDesc   = FLOW_DESC[currentStage] ?? '';
const flowsSection = selectedNs
  ? `- flow_name: "${selectedNs}" — ${flowDesc}`
  : '(no hay contenido multimedia para esta etapa — responde solo con texto)';

// --- Prompt estático (vive en tenants.config.system_prompt; fuente: n8n/prompts/setter-v1.md) ---
const staticPrompt = body.tenant?.config?.system_prompt ?? '';

// --- Bloque de contexto dinámico ---
const contextLines = [
  `La persona se llama: ${subscriberName}`,
  `Etapa actual del lead: ${currentStage}`,
];
if (lastSeen)        contextLines.push(`Última vez activa en Instagram: ${lastSeen}`);
if (lastInteraction) contextLines.push(`Última interacción contigo: ${lastInteraction}`);
if (signals)         contextLines.push(`Señales detectadas en turnos anteriores: ${typeof signals === 'string' ? signals : JSON.stringify(signals)}`);
if (calendlyUrl)     contextLines.push(`Link de Calendly para enviar en etapa B→C: ${calendlyUrl}`);
contextLines.push('');
contextLines.push('CONTENIDO DISPONIBLE para esta etapa (usa trigger_manychat_flow con el flow_name exacto):');
contextLines.push(flowsSection);
const dynamicContext = contextLines.join('\n');

// --- Prompt final ---
const systemPrompt = staticPrompt
  ? `${staticPrompt}\n\n# CONTEXTO\n${dynamicContext}`
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
    callbackToken: body.callback_token,
  }
}];
```

---

## Notas

- **No hay nodo "Get Tools"** en la cadena. El mapa de flows está en este nodo, no en una llamada HTTP.
- **El agente ve UN solo `flow_name`** por turno, ya pre-seleccionado. No tiene que elegir entre variantes.
- **Las variantes A/B** se resuelven aquí con `Math.random()`. Para desactivar una variante, borrarla del array en `FLOW_MAP`.
- **`system_prompt`** se lee de `tenants.config.system_prompt`. Ver `n8n/prompts/setter-v1.md` para la fuente versionada.
- **`calendly_url`** se lee de `tenants.config.calendly_url`. Añadirlo al config del tenant cuando esté disponible.
- **Variables pendientes** (`instagram_context`, `signals`): el código las consume pero el API aún no las envía — ver `SETTER-MVP-TRACKING.md P1`.
