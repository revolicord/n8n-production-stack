# Nodo: Build Context

**Tipo:** Code (JavaScript)  
**ID:** `fe31ef8f-cff7-40d7-8543-d60358245b69`  
**Versión:** v6  
**Posición en cadena:** Después de `Execute a SQL query1`, antes de `AI Agent`  
**ADR:** ADR-0010, ADR-0013, ADR-0023  
**Propósito:** Leer todos los inputs (Webhook, Get Stage Config, Get Subscriber CRM Context, Get Content History, Get Handoff State, System Prompt), construir el `chatInput` estructurado con `<context>` y `<lead_message>`, y propagar los metadatos necesarios para el Router. En v4 también computa `stageFlowsBySlug` desde `all_stages_flows` para que el Router resuelva slugs cross-stage. En v5 agrega historial de envío por `variant_group` en vez de por `slug_id` individual. En **v6** agrega la sección `handoff_state` (escalados/intervenciones humanas, leídos de `Get Handoff State`) y rinde **placeholders fieles por `content_class`** en `buildMessagesText` (en vez del genérico "contenido multimedia recibido").

---

## Diferencias clave v3 → v4 → v5 → v6

**v6 (ADR-0023):**
- Lee un nuevo input `Get Handoff State` (`api.notifications` recientes) y agrega la sección `handoff_state` al `contextJson` → el agente es consciente de escalados abiertos e intervenciones humanas.
- `buildMessagesText` rinde un **placeholder fiel por `content_class`** (`[audio sin transcribir]`, `[el lead envió una imagen]`, …) leyendo `m.content_class` del payload, en vez del genérico `[contenido multimedia recibido — no se puede leer]`. El espejo en código es `mediaPlaceholder()` de `@dm-api/shared`.

| v3 | v4 | v5 |
|----|----|----|
| No lee `all_stages_flows` | Lee `stageConfig.all_stages_flows` | Sin cambio |
| Sin `stageFlowsBySlug` en output | Exporta `stageFlowsBySlug` | Sin cambio |
| Router resuelve slugs solo en el stage actual | Router puede resolver slugs en cualquier stage | Sin cambio |
| `stageFlowsBySlug` no existe | Pre-colapsa variant groups por stage | Sin cambio |
| `collapseVariantGroups` no expone variantes del grupo | Sin cambio | `collapseVariantGroups` expone `allVariants` por grupo |
| Historial de `content_options` usa `sentMap[slug_id]` (variante elegida) | Sin cambio | **Historial agrega sentMap de TODAS las variantes del grupo** — fix bug de re-envío entre variantes |

**Bug que corrige v5:** si en el turno N se envió la variante v2 de un grupo, y en el turno N+1 `collapseVariantGroups` elige v1, el agente veía `times_sent: 0` para v1 y reenviaba el video. Con v5, agrega el historial de todo el grupo y ve `times_sent: 1`.

---

## Decisión de diseño: selección ponderada de variantes

`collapseVariantGroups()` agrupa los flows por `variant_group` y elige uno de cada grupo con selección ponderada (`pickWeighted`). El resultado es `selectedVariants`: mapa `slug_id → flow_ns` real.

El agente recibe la lista completa de `content_options` (una por grupo, ya colapsado). El Router hace el lookup `slug_id → flow_ns` cuando el agente elige uno.

---

## Código completo (copy-paste exacto del workflow)

```javascript
// ============================================================================
// BUILD CONTEXT v5
// ----------------------------------------------------------------------------
// Cambios respecto a v4:
//  - collapseVariantGroups incluye `allVariants` en cada grupo.
//  - content_options agrega historial de TODAS las variantes del grupo, no
//    solo de la elegida. Esto evita que el agente reenvíe contenido de un
//    grupo si ya se envió una variante distinta en un turno anterior.
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
    collapsed.push({ exposed: chosen, chosenVariant: chosen, allVariants: variants });
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

// v6: placeholder fiel por content_class (espejo de mediaPlaceholder() en
// @dm-api/shared). Si el payload no trae content_class (buffers viejos), cae a
// un genérico, pero la API ya lo envía en messages[].content_class.
function mediaPlaceholder(cls) {
  switch (cls) {
    case 'audio': return '[audio sin transcribir]';
    case 'image': return '[el lead envió una imagen]';
    case 'video': return '[el lead envió un video]';
    case 'location': return '[el lead compartió una ubicación]';
    case 'file': return '[el lead envió un archivo]';
    case 'share': return '[el lead compartió/respondió a una historia]';
    case 'sticker': return '[el lead reaccionó / envió un sticker]';
    case 'unknown': return '[contenido no soportado]';
    default: return '[mensaje sin texto]';
  }
}

function buildMessagesText(messages) {
  return (messages || [])
    .map(function (m) {
      const rt = normalizeReplyType(m.reply_type);
      if (rt === 'thumbs_up') return '👍 [el contacto reacciono con pulgar arriba]';
      if (!m.text) return mediaPlaceholder(m.content_class || 'unknown');
      return m.text;
    })
    .filter(Boolean)
    .join('\n');
}

// v6: colapsa las filas de Get Handoff State en la sección handoff_state.
function buildHandoffState(rows) {
  const items = (rows || []).filter(function (r) { return r && r.kind; });
  if (items.length === 0) return null;

  const open = items
    .filter(function (r) { return r.status === 'pending'; })
    .map(function (r) {
      return { kind: r.kind, reason: r.reason || null, age: daysAgoText(r.created_at) };
    });

  const handled = items
    .filter(function (r) { return r.status === 'resolved'; })
    .map(function (r) {
      return {
        kind: r.kind,
        resolved_by: r.resolved_by || null,
        note: r.summary || null,
        age: daysAgoText(r.resolved_at || r.created_at)
      };
    });

  const lastResolvedAt = items
    .filter(function (r) { return r.resolved_at; })
    .map(function (r) { return r.resolved_at; })
    .sort()
    .pop();

  if (open.length === 0 && handled.length === 0) return null;

  const out = {};
  if (open.length > 0) out.open_escalations = open;
  if (handled.length > 0) out.human_handled = handled;
  if (lastResolvedAt) out.last_human_action = daysAgoText(lastResolvedAt);
  return out;
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

const validTransitions = Array.isArray(stageConfig.valid_transitions)
  ? stageConfig.valid_transitions
  : [];

// NUEVO v4: catálogo completo de flows del tenant por stage_slug.
// Lo usa el Router para resolver slug_id en macros que tocan stages distintos
// al actual del lead.
const allStagesFlows = stageConfig.all_stages_flows || {};

const crm = $('Get Subscriber CRM Context').first()
  ? $('Get Subscriber CRM Context').first().json
  : {};

const historyItems = $('Get Content History').all()
  ? $('Get Content History').all().map(function (x) { return x.json; })
  : [];

// v6: filas de escalado/handoff recientes (api.notifications). Opcional: si el
// nodo no existe o no retorna filas, handoff_state queda null y se omite.
let handoffRows = [];
try {
  handoffRows = $('Get Handoff State').all()
    ? $('Get Handoff State').all().map(function (x) { return x.json; })
    : [];
} catch (e) {
  handoffRows = [];
}

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

const igCtx = body.instagram_context || {};
const signals = (sub.metadata && sub.metadata.signals)
  || (body.lead_state && body.lead_state.signals)
  || null;
const baseCalendlyUrl = (body.tenant && body.tenant.config && body.tenant.config.calendly_url) || null;
const calendlyUrl = baseCalendlyUrl && sub.id
  ? baseCalendlyUrl + (baseCalendlyUrl.includes('?') ? '&' : '?') + 'utm_content=' + sub.id
  : baseCalendlyUrl;

const staticPrompt = $('System Prompt').first()
  && $('System Prompt').first().json
  && $('System Prompt').first().json.staticPrompt
  ? $('System Prompt').first().json.staticPrompt
  : '';

// ----- Construccion de content_options con historial -----------------------

const collapsed = collapseVariantGroups(rawFlows);

const contentOptions = collapsed.map(function (c) {
  const slugId = c.exposed.slug_id || c.exposed.human_name;

  // v5: agregar historial de TODAS las variantes del grupo para que el agente
  // no reenvíe un grupo cuya variante distinta ya fue enviada en otro turno.
  const groupVariants = c.allVariants || [c.exposed];
  const groupEntries = groupVariants
    .map(function (v) { return sentMap[v.slug_id || v.human_name]; })
    .filter(Boolean);

  const sent = groupEntries.length > 0 ? {
    last_sent_at: groupEntries.reduce(function (max, s) {
      return s.last_sent_at > max ? s.last_sent_at : max;
    }, groupEntries[0].last_sent_at),
    ever_responded: groupEntries.some(function (s) { return s.ever_responded; }),
    times_sent: groupEntries.reduce(function (sum, s) { return sum + s.times_sent; }, 0)
  } : null;

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

// NUEVO v4: pre-cálculo de stageFlowsBySlug.
// Para cada stage del catálogo, colapsamos variant groups y nos quedamos con
// UN flow_ns por slug_id. El Router consulta este objeto como
// stageFlowsBySlug[stage_slug][slug_id] = flow_ns.
const stageFlowsBySlug = {};
for (const stageSlug in allStagesFlows) {
  const flowsOfStage = Array.isArray(allStagesFlows[stageSlug]) ? allStagesFlows[stageSlug] : [];
  const collapsedStage = collapseVariantGroups(flowsOfStage);
  const map = {};
  for (const c of collapsedStage) {
    const key = c.exposed.slug_id || c.exposed.human_name;
    if (key) map[key] = c.chosenVariant.flow_ns;
  }
  stageFlowsBySlug[stageSlug] = map;
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

// v6: conciencia de escalados/intervenciones. Solo se agrega si hay algo.
const handoffState = buildHandoffState(handoffRows);
if (handoffState) {
  contextJson.handoff_state = handoffState;
}

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

    // NUEVO v4: catálogo de slugs por stage para el Router (no para el agente).
    // NO se incluye en chatInput ni en contextJson — es solo para downstream.
    stageFlowsBySlug: stageFlowsBySlug,

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
| `selectedVariants` | object | Mapa `{ slug_id: flow_ns }` del stage actual — lookup directo en Router para acciones del agente |
| `stageFlowsBySlug` | object | Mapa `{ stage_slug: { slug_id: flow_ns } }` de todos los stages — usado por Router para resolver slugs cross-stage en macros (ej. `MS→B` manda audio que vive en MS) |
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
  },
  "handoff_state": {
    "open_escalations": [
      { "kind": "audio", "reason": "El lead envió un mensaje de audio", "age": "hace menos de 1 hora" }
    ],
    "human_handled": [
      { "kind": "keyword", "resolved_by": "dashboard", "note": "Ya lo llamé, tiene la info de precios", "age": "hace 2 hora(s)" }
    ],
    "last_human_action": "hace 2 hora(s)"
  }
}
```

> **`handoff_state` solo aparece si hay escalados recientes.** `open_escalations`
> = filas `pending` (algo que el agente no pudo leer o un `notify_human` sin
> resolver). `human_handled` = filas `resolved` (un humano intervino; `note` es
> la nota que dejó al reanudar). La regla 8 del system prompt le dice al agente
> que reconozca la interrupción y no arranque de cero. Fuente: nodo
> `Get Handoff State` (ver `00h-get-handoff-state.md`).

---

## Notas

- `reply_type === '{{last_reply_type}}'` (template sin resolver de ManyChat) se normaliza a `null` — `buildMessagesText` lo descarta.
- `instagram_context` ahora **sí** viaja en el payload: la API lo persiste en `subscribers.instagram_context` (migración 0005) y el worker lo reenvía. `igCtx = {}` solo si ManyChat nunca mandó presencia para ese lead. `last_seen` / `last_interaction` dependen de que ManyChat los incluya en el webhook entrante.
- Si `Get Stage Config` no retorna filas, `rawFlows = []` y `contentOptions = []` — el agente no tiene contenido para enviar.
