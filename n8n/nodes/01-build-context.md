# Nodo: Build Context

**Tipo:** Code (JavaScript)  
**Versión:** v3  
**Posición en cadena:** Después de `Execute a SQL query1`, antes de `AI Agent`  
**ADR:** ADR-0010, ADR-0013  
**Propósito:** Leer todos los inputs (Webhook, Get Stage Config, Get Subscriber CRM Context, Get Content History, System Prompt), construir el `chatInput` estructurado con `<context>` y `<lead_message>`, y propagar los metadatos necesarios para el Router.

---

## Diferencias clave v2 → v3

| v2 | v3 |
|----|----|
| Agente con herramientas (`trigger_manychat_flow`, `set_stage`) | Agente con Structured Output Parser (JSON plan) |
| Build Context elige 1 flow y lo presenta en texto plano | Build Context muestra TODOS los `content_options` enriquecidos con historial |
| `chatInput` = texto limpio de mensajes | `chatInput` = bloque `<context>…</context><lead_message>…</lead_message>` |
| Sin `selectedVariants` | Exporta `selectedVariants` para lookup en Router |
| Sin `contextJson` | Exporta `contextJson` completo para auditoría |

---

## Decisión de diseño: selección ponderada de variantes

`collapseVariantGroups()` agrupa los flows por `variant_group` y elige uno de cada grupo con selección ponderada (`pickWeighted`). El resultado es `selectedVariants`: mapa `slug_id → flow_ns` real.

El agente recibe la lista completa de `content_options` (una por grupo, ya colapsado). El Router hace el lookup `slug_id → flow_ns` cuando el agente elige uno.

---

## Código completo (copy-paste exacto del workflow)

```javascript
// ============================================================================
// BUILD CONTEXT v3
// ----------------------------------------------------------------------------
// Cambios respecto a v2:
//  - Lee Get Content History y enriquece content_options con last_sent.
//  - Lee valid_transitions como objetos { slug, when_to_use } (no slugs sueltos).
// ============================================================================

function daysAgoText(ts) {
  if (!ts) return null;
  const days = Math.round((Date.now() - new Date(ts).getTime()) / 86400000);
  const hours = Math.round((Date.now() - new Date(ts).getTime()) / 3600000);
  if (hours < 1) return 'hace menos de 1 hora';
  if (hours < 24) return 'hace ' + hours + ' hora(s)';
  return 'hace ' + days + ' día(s)';
}

function collapseVariantGroups(flows) {
  const groups = new Map();
  const singletons = [];

  for (const f of flows) {
    const g = f.variant_group;
    if (g && String(g).trim() !== '') {
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(f);
    } else {
      singletons.push(f);
    }
  }

  const collapsed = [];

  for (const f of singletons) {
    collapsed.push({ exposed: f, chosenVariant: f });
  }

  for (const [, variants] of groups) {
    const chosen = pickWeighted(variants);
    collapsed.push({ exposed: chosen, chosenVariant: chosen });
  }

  return collapsed;
}

function pickWeighted(arr) {
  if (!arr || arr.length === 0) return null;
  const total = arr.reduce((s, x) => s + (Number(x.weight) || 1), 0);
  let r = Math.random() * total;
  for (const x of arr) {
    r -= (Number(x.weight) || 1);
    if (r <= 0) return x;
  }
  return arr[arr.length - 1];
}

function normalizeReplyType(rt) {
  if (!rt || rt === '{{last_reply_type}}') return null;
  return rt;
}

function buildMessagesText(messages) {
  return (messages || [])
    .map(function (m) {
      const rt = normalizeReplyType(m.reply_type);
      if (rt === 'thumbs_up') return '👍 [el contacto reacciono con pulgar arriba]';
      if (m.media_urls && m.media_urls.length > 0 && !m.text) {
        return '[contenido multimedia recibido — no se puede leer]';
      }
      return m.text || '[mensaje sin texto]';
    })
    .filter(Boolean)
    .join('\n');
}

// ----- Lectura de inputs ----------------------------------------------------

const raw = $('Webhook').first().json;
const body = raw.body || raw;

const sub = body.subscriber || {};
const subscriberName = sub.display_name || sub.ig_username || 'la persona';
const currentStageSlug = sub.lead_stage
  || (sub.metadata && sub.metadata.stage)
  || 'A';

const stageConfig = $('Get Stage Config').first()
  ? $('Get Stage Config').first().json
  : {};

const rawFlows = Array.isArray(stageConfig.flows) ? stageConfig.flows : [];

// valid_transitions ahora viene como [{ slug, when_to_use }, ...]
const validTransitions = Array.isArray(stageConfig.valid_transitions)
  ? stageConfig.valid_transitions
  : [];

const crm = $('Get Subscriber CRM Context').first()
  ? $('Get Subscriber CRM Context').first().json
  : {};

// NUEVO: Content History
// Get Content History devuelve N filas, una por slug_id ya enviado.
// Llegamos a un array de items con { slug_id, last_sent_at, ever_responded, times_sent }.
const historyItems = $('Get Content History').all()
  ? $('Get Content History').all().map(function (x) { return x.json; })
  : [];

// Mapa { slug_id: { last_sent_at, ever_responded, times_sent } }
const sentMap = {};
for (const h of historyItems) {
  if (h && h.slug_id) {
    sentMap[h.slug_id] = {
      last_sent_at: h.last_sent_at,
      ever_responded: !!h.ever_responded,
      times_sent: Number(h.times_sent) || 0
    };
  }
}

const followupsSent = crm.followups_sent || 0;
const maxFollowups = stageConfig.max_followups || crm.max_followups || 3;
const followupHistory = Array.isArray(crm.followup_history) ? crm.followup_history : [];

// La API lo envía desde subscribers.instagram_context (migración 0005). {} si nunca llegó.
const igCtx = body.instagram_context || {};
const signals = (sub.metadata && sub.metadata.signals)
  || (body.lead_state && body.lead_state.signals)
  || null;
const calendlyUrl = (body.tenant && body.tenant.config && body.tenant.config.calendly_url) || null;

const staticPrompt = $('System Prompt').first()
  && $('System Prompt').first().json
  && $('System Prompt').first().json.staticPrompt
  ? $('System Prompt').first().json.staticPrompt
  : '';

// ----- Construccion de content_options con historial -----------------------

const collapsed = collapseVariantGroups(rawFlows);

const contentOptions = collapsed.map(function (c) {
  const slugId = c.exposed.slug_id || c.exposed.human_name;
  const sent = sentMap[slugId];

  return {
    slug_id: slugId,
    type: c.exposed.media_type || null,
    description: c.exposed.content_description || null,
    when_to_use: c.exposed.usage_condition || null,
    last_sent: sent ? daysAgoText(sent.last_sent_at) : null,
    lead_responded_to_it: sent ? sent.ever_responded : null,
    times_sent: sent ? sent.times_sent : 0
  };
});

const selectedVariants = {};
for (const c of collapsed) {
  const key = c.exposed.slug_id || c.exposed.human_name;
  selectedVariants[key] = c.chosenVariant.flow_ns;
}

// ----- Construccion del contextJson -----------------------------------------

const contextJson = {
  lead: {
    name: subscriberName,
    last_seen: igCtx.last_seen || null,
    last_interaction: igCtx.last_interaction || null
  },
  stage: {
    slug: currentStageSlug,
    goal: stageConfig.goal || crm.stage_goal || stageConfig.description || null,
    valid_transitions: validTransitions
  },
  content_options: contentOptions,
  followups: {
    sent: followupsSent,
    max: maxFollowups,
    history: followupHistory.map(function (h) {
      return {
        seq: h.seq,
        days_ago: h.sent_at ? Math.round((Date.now() - new Date(h.sent_at).getTime()) / 86400000) : null,
        responded: !!h.responded_at
      };
    })
  },
  extras: {
    calendly_url: calendlyUrl,
    signals: signals
  }
};

// ----- System prompt y chatInput --------------------------------------------

const systemPrompt = staticPrompt;
const userMessages = buildMessagesText(body.messages);

const chatInput =
  '<context>\n' + JSON.stringify(contextJson, null, 2) + '\n</context>\n\n' +
  '<lead_message>\n' + userMessages + '\n</lead_message>';

// ----- Output ---------------------------------------------------------------

return [{
  json: {
    chatInput: chatInput,
    systemPrompt: systemPrompt,
    contextJson: contextJson,
    selectedVariants: selectedVariants,

    subscriberId: sub.manychat_subscriber_id,
    subscriberDbId: sub.id,
    tenantDbId: (body.tenant && body.tenant.id) || '',
    mcApiKey: (body.tenant && body.tenant.config && body.tenant.config.manychat_api_key) || '',
    conversationId: body.conversation && body.conversation.id,
    turnId: body.turn_id,
    currentStage: currentStageSlug,
    callbackUrl: body.callback_url,
    callbackToken: body.callback_token
  }
}];
```

---

## Output que produce Build Context

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `chatInput` | string | Bloque `<context>…</context><lead_message>…</lead_message>` — va al AI Agent |
| `systemPrompt` | string | Prompt estático del Set node — va al AI Agent como System Message |
| `contextJson` | object | El objeto de contexto completo (para auditoría) |
| `selectedVariants` | object | Mapa `{ slug_id: flow_ns }` — usado por Router para lookup |
| `subscriberId` | string | `manychat_subscriber_id` numérico — para llamadas a ManyChat API |
| `subscriberDbId` | UUID | `subscriber.id` interno de la DB — para queries Postgres |
| `tenantDbId` | UUID | `tenant.id` — para queries Postgres |
| `mcApiKey` | string | API key de ManyChat del tenant |
| `conversationId` | UUID | `conversation.id` |
| `turnId` | UUID | `turn_id` del payload — para marcar turn-completed |
| `currentStage` | string | Slug de la etapa actual (`'A'`, `'MS'`, etc.) |
| `callbackUrl` | string | URL para llamar turn-completed al finalizar |
| `callbackToken` | string | Token Bearer para autenticar el callback |

---

## Estructura de `contextJson` (lo que ve el LLM)

```json
{
  "lead": {
    "name": "AI Engineer",
    "last_seen": null,
    "last_interaction": null
  },
  "stage": {
    "slug": "A",
    "goal": "Conseguir que el lead vea el video y reaccione con pulgar arriba",
    "valid_transitions": [
      { "slug": "MS", "when_to_use": "El lead confirma que vio el video o reacciona positivamente" },
      { "slug": "disqualified", "when_to_use": "Declara que no le interesa" }
    ]
  },
  "content_options": [
    {
      "slug_id": "QC_A_VIDEO_HOOK",
      "type": "video",
      "description": "Video hook 25s",
      "when_to_use": "Primer turno o cuando el lead saluda",
      "last_sent": null,
      "lead_responded_to_it": null,
      "times_sent": 0
    }
  ],
  "followups": {
    "sent": 0,
    "max": 3,
    "history": []
  },
  "extras": {
    "calendly_url": "https://quantumcreators.es/llamada-de-discovery",
    "signals": null
  }
}
```

---

## Notas

- `reply_type === '{{last_reply_type}}'` (template sin resolver de ManyChat) se normaliza a `null` — `buildMessagesText` lo descarta.
- `instagram_context` ahora **sí** viaja en el payload: la API lo persiste en `subscribers.instagram_context` (migración 0005) y el worker lo reenvía. `igCtx = {}` solo si ManyChat nunca mandó presencia para ese lead. `last_seen` / `last_interaction` dependen de que ManyChat los incluya en el webhook entrante.
- Si `Get Stage Config` no retorna filas, `rawFlows = []` y `contentOptions = []` — el agente no tiene contenido para enviar.
