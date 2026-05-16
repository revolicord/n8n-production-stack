# Nodo: Build Context

**Tipo:** Code (JavaScript)  
**Posición en cadena:** 1 — después de `Get Stage Config` y `Get Subscriber CRM Context`  
**ADR:** ADR-0010, ADR-0013  
**Propósito:** Normalizar el payload entrante, seleccionar el flow de ManyChat con selección ponderada, construir el bloque CRM, y producir el system prompt final.

> El mapa de flows ya NO vive aquí — está en `funnel_stages` + `stage_flows` en Postgres.  
> `Get Stage Config` (nodo 00) lee la configuración antes de llegar a este nodo.

## Decisión de diseño: el round-robin lo hace Build Context, NO el agente

`pickFlowWeighted()` elige el flow **antes** de que el agente reciba el prompt. Al agente le llega **un único flow** ya seleccionado — no la lista completa. Esto es deliberado:

- El agente no decide qué contenido enviar: Build Context ya lo decidió.
- El agente solo decide **cuándo** usar ese flow dentro de la conversación.
- La selección es determinista desde el punto de vista del LLM: no hay "creatividad" ni variabilidad en la elección de multimedia.
- Los pesos (`weight` en `stage_flows`) controlan la distribución A/B sin tocar el prompt.

---

## Código completo (copy-paste)

```javascript
// ─── Selección ponderada de flow (reemplaza Math.random() puro) ──────────────
function pickFlowWeighted(flows) {
  if (!flows || flows.length === 0) return null;
  const total = flows.reduce((s, f) => s + (f.weight ?? 1), 0);
  let r = Math.random() * total;
  for (const f of flows) {
    r -= (f.weight ?? 1);
    if (r <= 0) return f;
  }
  return flows[flows.length - 1];
}

// ─── Construcción del bloque CRM (ADR-0013) ───────────────────────────────────
function buildCrmBlock(followupsSent, maxFollowups, history, stageName, stageObjective) {
  const lines = ['# ESTADO CRM DEL LEAD'];
  lines.push(`Etapa: ${stageName}${stageObjective ? ` — ${stageObjective}` : ''}`);

  if (followupsSent === 0) {
    lines.push('Seguimientos enviados: ninguno. Es el primer contacto o acaba de responder.');
  } else {
    lines.push(`Seguimientos enviados sin respuesta: ${followupsSent} de ${maxFollowups} máximo.`);
    (history ?? []).forEach(h => {
      const daysAgo = Math.round((Date.now() - new Date(h.sent_at)) / 86400000);
      const responded = h.responded_at ? ' ← respondió' : ' (sin respuesta)';
      lines.push(`  - #${h.seq} hace ${daysAgo} día(s)${responded}`);
    });
    if (followupsSent >= maxFollowups) {
      lines.push('⚠️ Límite de seguimientos alcanzado. Si no hay interés real en este turno, usa archive_conversation.');
    } else {
      lines.push('Está respondiendo tras un silencio. Sé cálido; no menciones los seguimientos.');
    }
  }
  return lines.join('\n');
}

// ─── Datos del webhook ────────────────────────────────────────────────────────
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
const currentStage = sub.lead_stage ?? sub.metadata?.stage ?? 'A';

// ─── Config de etapa desde DB (Get Stage Config) ─────────────────────────────
const stageConfig = $('Get Stage Config').first()?.json ?? {};
const flows       = stageConfig.flows ?? [];
const stageDesc   = stageConfig.description ?? '';
const maxFollowups = stageConfig.max_followups ?? 3;

const selectedFlow = pickFlowWeighted(flows);

function buildFlowLine(f) {
  const lines = [];
  lines.push('→ flow_name (cópialo EXACTO, carácter por carácter, no lo traduzcas ni lo parafrasees):');
  lines.push(`  ${f.flow_ns}`);
  lines.push('');
  if (f.media_type) {
    lines.push(`  Tipo: [${f.media_type}]`);
  }
  const condition = f.usage_condition ?? f.description ?? '';
  if (condition) {
    lines.push(`  Cuándo: ${condition}`);
  }
  if (f.content_description) {
    lines.push(`  Contenido: ${f.content_description}`);
  }
  return lines.join('\n');
}

const flowsSection = selectedFlow
  ? buildFlowLine(selectedFlow)
  : '(no hay contenido multimedia para esta etapa — responde solo con texto)';

// ─── Contexto CRM desde DB (Get Subscriber CRM Context) ──────────────────────
const crm            = $('Get Subscriber CRM Context').first()?.json ?? {};
const followupsSent  = crm.followups_sent  ?? 0;
const history        = crm.followup_history ?? [];
const stageName      = crm.stage_name      ?? stageConfig.display_name ?? currentStage;
const stageObjective = crm.stage_objective ?? stageDesc;

const crmBlock = buildCrmBlock(followupsSent, maxFollowups, history, stageName, stageObjective);

// --- Presencia (heurística Media Seen — pendiente: API aún no envía esto) ---
const igCtx = body.instagram_context ?? {};
const lastSeen = igCtx.last_seen ?? null;
const lastInteraction = igCtx.last_interaction ?? null;

// --- Señales detectadas en turnos anteriores ---
const signals = sub.metadata?.signals ?? body.lead_state?.signals ?? null;

// --- Link de Calendly (para etapa B→C) ---
const calendlyUrl = body.tenant?.config?.calendly_url ?? '';

// --- Prompt estático (vive en el Set node "System Prompt" del workflow) ---
const staticPrompt = $('System Prompt').first()?.json?.staticPrompt ?? '';

// --- Bloque de contexto dinámico ---
const contextLines = [
  `La persona se llama: ${subscriberName}`,
  `Etapa actual del lead: ${currentStage}${stageDesc ? ` — ${stageDesc}` : ''}`,
];
if (lastSeen)        contextLines.push(`Última vez activa en Instagram: ${lastSeen}`);
if (lastInteraction) contextLines.push(`Última interacción contigo: ${lastInteraction}`);
if (signals)         contextLines.push(`Señales detectadas en turnos anteriores: ${typeof signals === 'string' ? signals : JSON.stringify(signals)}`);
if (calendlyUrl)     contextLines.push(`Link de Calendly para enviar en etapa B→C: ${calendlyUrl}`);
contextLines.push('');
contextLines.push('CONTENIDO DISPONIBLE para esta etapa (usa trigger_manychat_flow con el flow_name exacto):');
contextLines.push(flowsSection);

// Añadir bloque CRM al final del contexto
contextLines.push('');
contextLines.push(crmBlock);

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

## Cambios respecto a la versión anterior

| Antes | Ahora |
|---|---|
| `FLOW_MAP` hardcodeado con slugs de flows | Lee flows desde `Get Stage Config` (DB) |
| `Math.random() * variants.length` (50/50) | `pickFlowWeighted(flows)` (pesos configurables) |
| Sin bloque CRM | `buildCrmBlock()` inyectado al final del system prompt |
| `FLOW_DESC` hardcodeado | `description` viene del campo `funnel_stages.description` en DB |

## Notas

- Si `Get Stage Config` no retorna filas (etapa desconocida), el agente opera sin flow multimedia. Loguear el caso.
- Si `Get Subscriber CRM Context` no retorna filas (primera vez), el bloque CRM muestra "ningún seguimiento" — comportamiento correcto.
- El bloque CRM es determinista (viene de la DB, no del LLM): no hay alucinaciones en el estado del lead.
- `calendly_url` se lee de `tenants.config.calendly_url`. Configurarlo en el tenant cuando esté disponible.
