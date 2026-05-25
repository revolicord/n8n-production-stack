# 13 · Dashboard de métricas y notificaciones

> **⚠️ PENDIENTE — no implementado.** Este es **el diseño del panel que falta** (la pieza principal pendiente del MVP, ver [`status.md`](../status.md)): conteo de leads por etapa, tasas MSR/PRR/CSR/ABR y estadísticas de follow-ups. No existen ni los endpoints (`/admin/stats/*`, `/admin/leads`, `/admin/notifications`) ni la SPA admin.
>
> **Aviso sobre las queries SQL de abajo**: se escribieron contra un modelo de datos anterior y hay que adaptarlas al schema real (ver [04-modelo-de-datos](04-modelo-de-datos.md)): usar `stage_transitions.created_at` (no `occurred_at`); **no existen** `lead_stages.entered_stage_at`, `follow_up_count` ni `disqualification_reason` — esos datos viven en `stage_transitions`, `lead_followup_log` y `lead_crons`. Tampoco existen aún las tablas `closers` ni `notifications`.

Reemplaza el Excel "DM Sorcery Tracker" por una vista en tiempo real para ver el sistema funcionar y detectar leads que necesitan acción humana.

## Objetivo del dashboard

1. Mostrar las **5 métricas del Excel** (MSR, PRR, CSR, ABR, transiciones) en tiempo real.
2. **Listar los leads en cada etapa** con su última actividad y próximo follow-up.
3. **Centro de notificaciones** para que Alex vea qué leads necesitan llamada IG o atención manual.
4. **Editor de plantillas** de follow-up sin tocar código.
5. **Inspección de un lead concreto** con su historial completo.

## Stack del dashboard

Para el MVP, dos opciones. Recomendación clara:

| Opción | Pros | Contras | Recomendación |
|---|---|---|---|
| **Grafana embebido** | Cero código, listo en horas, dashboards SQL directos | No permite acciones (botones de retry, marcar notificación, etc.) | ✅ Para métricas |
| **Admin web propio** (SvelteKit) | UI completa, acciones, custom | Hay que programarlo | ✅ Para listas + acciones |

**Decisión MVP**: combinamos los dos.

- **Grafana** para los gráficos y métricas agregadas (lo que reemplaza la pestaña "Dashboard" del Excel).
- **Admin web** (`apps/admin`) para listas accionables (notificaciones, leads por etapa, editor de plantillas).

Ambos detrás del mismo Traefik en `https://admin.<dominio-alex>` con auth JWT.

## Layout del admin web

```
┌────────────────────────────────────────────────────────────────────┐
│ Quantum Creators · DM Setter                  [🔔 3]  [Alex ⌄]    │
├──────────────┬──────────────────────────────────────────────────────┤
│              │                                                       │
│ Inicio       │  ┌─ Resumen del día ────────────────────────────┐   │
│ Leads        │  │  Iniciados hoy: 23   Booked hoy: 2           │   │
│ Notificac.🔔3│  │  Activos en funnel: 187    DLQ: 0            │   │
│ Follow-ups   │  └─────────────────────────────────────────────┘   │
│ Closers      │                                                       │
│ Plantillas   │  ┌─ Funnel actual ──────────────────────────────┐   │
│ Métricas →   │  │  A: 87  MS: 41  B: 28  C: 18  D: 13          │   │
│ Configurac.  │  │  [───][══][══][══][══]                        │   │
│              │  └─────────────────────────────────────────────┘   │
│              │                                                       │
│              │  ┌─ Notificaciones pendientes ──────────────────┐   │
│              │  │  🔴 3 leads esperando llamada IG              │   │
│              │  │  ▸ @ingenieroenia (B, 7d sin avance)         │   │
│              │  │  ▸ @maartinn.73 (MS, 9d sin avance)          │   │
│              │  │  ▸ @yiri_chaer (B, 8d sin avance)            │   │
│              │  └─────────────────────────────────────────────┘   │
│              │                                                       │
└──────────────┴──────────────────────────────────────────────────────┘
```

## Vistas

### 1. Inicio (overview)

Resumen del día y accesos rápidos. Llama a `GET /admin/stats/overview?since=24h`.

### 2. Leads

Tabla paginada con filtros. Columnas:

| Columna | Datos |
|---|---|
| Lead | @username con link a `instagram.com/<username>` |
| Etapa | Badge con color (A=gris, MS=azul, B=verde, C=naranja, D=oro) |
| Última actividad | `last_user_msg_at` formateado relativo ("hace 2h") |
| Follow-up | `follow_up_count`/8 + "próximo en X" |
| Closer | nombre del closer asignado (si aplica) |
| Acciones | botones [Ver] [Pausar] [Descalificar] |

Filtros: por etapa, por closer, por última actividad (hoy/semana/mes), por status (activo/descalificado/perdido).

Llama a `GET /admin/leads?stage=B&limit=50`.

### 3. Notificaciones

Centro de notificaciones que el agente crea automáticamente.

```
┌─────────────────────────────────────────────────────────────────┐
│ Notificaciones                                  [Filtrar: pending ⌄] │
├─────────────────────────────────────────────────────────────────┤
│ 🔴 LLAMADA IG · @ingenieroenia                  hace 2 horas    │
│ Lead en B, 5 follow-ups sin respuesta. Última: hace 7 días.    │
│ Audio recomendado: el de "última llamada".                      │
│ [Ver lead]  [Marcar como llamado]  [Posponer 24h]              │
├─────────────────────────────────────────────────────────────────┤
│ 🟡 OBJECIÓN NO RESUELTA · @maartinn.73          hace 5 horas    │
│ El agente intentó rebatir 2 veces sin éxito. Frase: "no veo    │
│ cómo me va a ayudar esto si ya tengo cerrado todo".            │
│ [Ver conversación]  [Tomar control]  [Marcar como perdido]      │
├─────────────────────────────────────────────────────────────────┤
│ 🟢 LEAD BOOKED · @yiri_chaer                    hace 1 día      │
│ Reservó llamada con Santi para el martes 12 a las 11:00.       │
│ [Ver en Calendly]  [✓ Visto]                                    │
└─────────────────────────────────────────────────────────────────┘
```

Endpoints implicados:
- `GET /admin/notifications?seen=false`
- `POST /admin/notifications/:id/seen`
- `POST /admin/notifications/:id/resolve` (con cuerpo opcional `{ note }`)

### 4. Follow-ups

Vista de qué leads tienen follow-up programado en las próximas 24h.

Útil para que Alex pueda interceptar manualmente algún lead específico antes de que el bot le mande follow-up.

### 5. Closers

CRUD simple de la tabla `closers`. Activar/desactivar, editar Calendly URL, ver `assignment_count`.

### 6. Plantillas

Editor en línea de las filas de `follow_up_templates`. Por etapa (A, MS, B, C) y por índice (1-8), Alex edita el texto, cambia tipo (texto/audio/meme/sticker), define delay.

```
Etapa A · Follow-up 1 (24h después de entrar en A)
[Tipo: Texto ▼]
┌──────────────────────────────────────────┐
│ Hey, ¿pudiste ver el vídeo? 👀          │
└──────────────────────────────────────────┘
[Activo: ✓]  [Guardar]
```

Endpoint: `PATCH /admin/follow-up-templates/:id`.

### 7. Métricas (link a Grafana)

Botón que abre Grafana en nueva pestaña con el dashboard "DM Setter Quantum".

### 8. Configuración

- Editor de `tenants.config` (debounce_ms, max_wait_ms, model LLM, system_prompt path).
- Editor de `tenants.config.flows` (mapeo flow_name → flow_ns de ManyChat).
- Botón "Test webhook" que dispara un payload sintético al webhook para validar.

## Dashboards Grafana

Dashboard 1: **"DM Setter — Visión general"**

Replica la pestaña "Dashboard" del Excel:

```
┌─────────────────────────────────────────────────────────┐
│ Periodo: [Mes actual ▼]                                  │
├─────────────────────────────────────────────────────────┤
│  Iniciados (A)        Total: 712                        │
│  Media Seen (MS)      Total: 41    [▓▓▓▓▓░░░] 5.7%      │
│  Engaged (B)          Total: 83    [▓▓▓░░░░░] 11.6%     │
│  Calendly'd (C)       Total: 39    [▓░░░░░░░] 5.4%      │
│  Booked (D)           Total: 21    [▓░░░░░░░] 2.9%      │
│                                                          │
│  MSR  ━━━━━━━━━━ 5.7%  (vs Excel histórico: ~30%)       │
│  PRR  ━━━━━━━━━━ 11.6%                                   │
│  CSR  ━━━━━━━━━━ 5.4%                                    │
│  ABR  ━━━━━━━━━━ 2.9%                                    │
├─────────────────────────────────────────────────────────┤
│  Transiciones                                            │
│  A→MS  ████████████████████░░  41/712 (5.7%)             │
│  MS→B  ██████████████████████  83/41  (todos+)           │
│  B→C   ██████████████░░░░░░░░  39/83  (47%)              │
│  C→D   ██████████░░░░░░░░░░░░  21/39  (53%)              │
└─────────────────────────────────────────────────────────┘

[Tendencia mensual de cada etapa - line chart]
[Heatmap de actividad por hora del día]
```

Dashboard 2: **"DM Setter — Operación"**

Para el día a día:

- Mensajes/min (line chart, últimas 24h)
- Turns/min completed vs failed
- Latencia turn p50/p95
- Coste LLM hoy / mes
- DLQ size
- Leads activos por etapa (line chart cómo evolucionan)
- Top 10 closers por leads asignados

Dashboard 3: **"DM Setter — Calidad del agente"**

- Objeciones resueltas / objeciones a descalificación (ratio)
- Distribución de razones de descalificación
- Tiempo medio en cada etapa (box plot)
- % de leads escalados a humano

## Queries SQL clave

Todas usan `tenant_id` filtrado y rangos de fecha como variables de Grafana.

### Conteos por etapa (mes actual)

```sql
SELECT
  current_stage,
  count(*) AS total
FROM api.lead_stages
WHERE tenant_id = '$tenant_id'
  AND entered_stage_at >= date_trunc('month', now())
GROUP BY current_stage
ORDER BY array_position(
  ARRAY['A','MS','B','C','D','disqualified','lost','escalated_human_call'],
  current_stage
);
```

### MSR/PRR/CSR/ABR (mes actual)

```sql
WITH funnel AS (
  SELECT
    count(*) FILTER (WHERE current_stage IN ('A','MS','B','C','D')) AS total_a_or_more,
    count(*) FILTER (WHERE current_stage IN ('MS','B','C','D'))    AS total_ms_or_more,
    count(*) FILTER (WHERE current_stage IN ('B','C','D'))         AS total_b_or_more,
    count(*) FILTER (WHERE current_stage IN ('C','D'))             AS total_c_or_more,
    count(*) FILTER (WHERE current_stage = 'D')                    AS total_d
  FROM api.lead_stages
  WHERE tenant_id = '$tenant_id'
    AND entered_stage_at >= date_trunc('month', now())
)
SELECT
  total_ms_or_more::float / NULLIF(total_a_or_more, 0) AS msr,
  total_b_or_more::float  / NULLIF(total_a_or_more, 0) AS prr,
  total_c_or_more::float  / NULLIF(total_a_or_more, 0) AS csr,
  total_d::float          / NULLIF(total_a_or_more, 0) AS abr
FROM funnel;
```

### Tasas de transición entre etapas consecutivas

```sql
WITH from_to AS (
  SELECT
    from_stage,
    to_stage,
    count(DISTINCT lead_stage_id) AS unique_leads
  FROM api.stage_transitions
  WHERE tenant_id = '$tenant_id'
    AND occurred_at >= date_trunc('month', now())
  GROUP BY from_stage, to_stage
),
totals AS (
  SELECT current_stage, count(*) AS leads
  FROM api.lead_stages
  WHERE tenant_id = '$tenant_id'
    AND entered_stage_at >= date_trunc('month', now())
  GROUP BY current_stage
)
SELECT
  ft.from_stage || ' → ' || ft.to_stage AS transition,
  ft.unique_leads,
  t.leads AS base,
  ft.unique_leads::float / NULLIF(t.leads, 0) AS rate
FROM from_to ft
JOIN totals t ON t.current_stage = ft.from_stage
WHERE (ft.from_stage, ft.to_stage) IN (
  ('A','MS'), ('MS','B'), ('B','C'), ('C','D')
)
ORDER BY array_position(ARRAY['A','MS','B','C'], ft.from_stage);
```

### Tendencia diaria de booked (último mes)

```sql
SELECT
  date_trunc('day', occurred_at) AS day,
  count(DISTINCT lead_stage_id) AS booked
FROM api.stage_transitions
WHERE tenant_id = '$tenant_id'
  AND to_stage = 'D'
  AND occurred_at >= now() - interval '30 days'
GROUP BY 1
ORDER BY 1;
```

### Coste LLM por día

```sql
SELECT
  date_trunc('day', completed_at) AS day,
  sum(cost_usd) AS cost_usd,
  sum(input_tokens) AS in_tokens,
  sum(output_tokens) AS out_tokens,
  count(*) AS turns
FROM api.turns
WHERE tenant_id = '$tenant_id'
  AND completed_at >= now() - interval '30 days'
GROUP BY 1
ORDER BY 1;
```

### Distribución de razones de descalificación

```sql
SELECT
  disqualification_reason,
  count(*) AS leads
FROM api.lead_stages
WHERE tenant_id = '$tenant_id'
  AND current_stage = 'disqualified'
  AND entered_stage_at >= date_trunc('month', now())
GROUP BY 1
ORDER BY 2 DESC;
```

### Tiempo medio en cada etapa

```sql
WITH stage_durations AS (
  SELECT
    lead_stage_id,
    from_stage,
    to_stage,
    occurred_at - lag(occurred_at) OVER (
      PARTITION BY lead_stage_id ORDER BY occurred_at
    ) AS duration
  FROM api.stage_transitions
  WHERE tenant_id = '$tenant_id'
)
SELECT
  from_stage,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY duration) AS p50_duration,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY duration) AS p95_duration
FROM stage_durations
WHERE duration IS NOT NULL
GROUP BY from_stage
ORDER BY array_position(ARRAY['A','MS','B','C'], from_stage);
```

## Endpoints admin específicos del funnel

Añadidos a la lista del doc 05:

```
GET    /admin/leads?stage=&closer=&search=&limit=&offset=
GET    /admin/leads/:id                       Detalle completo (timeline)
POST   /admin/leads/:id/disqualify            Body: { reason, note }
POST   /admin/leads/:id/reactivate            Vuelve a 'A'
POST   /admin/leads/:id/move-stage            Body: { to_stage, reason }  (override manual)

GET    /admin/notifications?seen=&type=
POST   /admin/notifications/:id/seen
POST   /admin/notifications/:id/resolve       Body: { note }

GET    /admin/follow-up-templates?stage=
PATCH  /admin/follow-up-templates/:id
POST   /admin/follow-up-templates/seed        Reset a defaults

GET    /admin/closers
POST   /admin/closers
PATCH  /admin/closers/:id

GET    /admin/stats/funnel?since=             MSR/PRR/CSR/ABR + breakdown por etapa
GET    /admin/stats/transitions?since=
GET    /admin/stats/disqualifications?since=
GET    /admin/stats/costs?since=

POST   /webhook/calendly                       Webhook entrante de Calendly
                                                (verifica firma, lead → D)
```

## Webhook de Calendly

Calendly envía webhook cuando alguien reserva. Es lo que dispara la transición C → D.

```ts
// apps/api/src/routes/webhook-calendly.ts
async function handleCalendlyWebhook(req, reply) {
  // Verificar firma HMAC de Calendly
  const sig = req.headers['calendly-webhook-signature'];
  if (!verifyCalendlySignature(req.rawBody, sig, process.env.CALENDLY_WEBHOOK_KEY)) {
    return reply.code(401).send();
  }

  const event = req.body;
  if (event.event !== 'invitee.created') return reply.code(200).send();

  // Extraer subscriber del custom answer (Calendly pregunta el ig_username
  // en el formulario de booking, configurable)
  const igUsername = event.payload.questions_and_answers
    .find(q => q.question === 'Tu Instagram')?.answer;

  if (!igUsername) {
    log.warn({ event }, 'Calendly booking without IG username');
    return reply.code(200).send();
  }

  // Buscar lead
  const lead = await db.findLeadByIgUsername(tenantId, igUsername);
  if (!lead) {
    log.warn({ igUsername }, 'Booking from unknown lead');
    return reply.code(200).send();
  }

  // Transicionar a D
  await transitionStage(lead.id, 'D', 'calendly_booked', 'system', {
    calendly_event_uri: event.payload.uri,
    closer_email: event.payload.event.event_memberships[0].user_email,
    scheduled_at: event.payload.scheduled_event.start_time,
  });

  // Cancelar follow-ups
  await db.cancelFollowUps(lead.id);

  // Notificación
  await db.createNotification({
    tenant_id: tenantId,
    type: 'lead_booked',
    subscriber_id: lead.subscriber_id,
    lead_stage_id: lead.id,
    title: `Lead booked: @${igUsername}`,
    body: `Reservó con ${closerName} el ${formatDate(scheduledAt)}`,
    payload: { calendly_uri: event.payload.uri },
  });

  return reply.code(200).send();
}
```

Configuración en Calendly: añadir webhook a `https://api.<dominio>/webhook/calendly` con scope `invitee.created`. Calendly da una signing key, va en `CALENDLY_WEBHOOK_KEY`.

**Importante**: Calendly necesita una pregunta personalizada en el formulario de booking del tipo "Tu Instagram" para que el lead pegue su username. Sin eso, no podemos vincular el booking al lead. Alternativa: usar el campo email + cruce contra `subscribers` (pero requiere que el lead haya dado email previamente al bot, lo cual no garantizamos en MVP).

**Para el MVP**: pedir a Alex que añada la pregunta "Tu Instagram (@username)" como obligatoria en sus 3 Calendly de los closers.

## Notification center: tipos de notificación

| Type | Cuándo se crea | Acción esperada |
|---|---|---|
| `human_call_required` | Tras follow-up 5 (día 7) sin avance | Alex llama por IG |
| `objection_unresolved` | Agente fracasa 2x rebatiendo objeción | Alex toma control conversación |
| `lead_booked` | Calendly webhook → D | Informativa |
| `agent_uncertain` | Agente devuelve confidence bajo (sub-feature futura) | Alex revisa el batch y decide |
| `system_alert` | DLQ creciendo, error tasa alta | Atender técnicamente |

## Auth simple para MVP

```ts
// apps/api/src/routes/admin/auth.ts
fastify.post('/admin/login', async (req, reply) => {
  const { password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD) {
    return reply.code(401).send();
  }
  const token = jwt.sign(
    { role: 'admin', sub: 'alex' },
    process.env.ADMIN_JWT_SECRET,
    { expiresIn: '8h' }
  );
  return { token };
});
```

Una sola contraseña maestra (`ADMIN_PASSWORD` en env). Genera JWT 8h.

Para el admin web: pantalla de login simple → guarda JWT en httpOnly cookie → todas las llamadas a `/admin/*` lo envían.

Cuando Alex tenga ayudantes, se evoluciona a tabla `admin_users`. Para MVP: una clave.

## Stack del admin web

```
apps/admin/
├── src/
│   ├── routes/
│   │   ├── +layout.svelte           Auth check + sidebar
│   │   ├── +page.svelte             Dashboard inicio
│   │   ├── leads/
│   │   ├── notifications/
│   │   ├── follow-ups/
│   │   ├── closers/
│   │   ├── templates/
│   │   └── settings/
│   ├── lib/
│   │   ├── api.ts                   Cliente fetch a Fastify
│   │   ├── auth.ts                  Helper JWT
│   │   └── components/
│   ├── app.html
│   └── hooks.server.ts              Verificar JWT en cada request
├── package.json
└── svelte.config.js
```

Stack: SvelteKit + Tailwind + shadcn/ui (svelte). UI rápida y simple. Sin estado complejo, todo viene del API.

Build: `pnpm --filter admin build` → `apps/admin/build/` → servido por Traefik o un Node server simple.

Auth: cookie httpOnly con JWT, hooks.server.ts verifica en cada request server-side.

## Sub-workflows de n8n para el dashboard

Algunos workflows pequeños en n8n que el dashboard puede invocar via webhook:

- `wf_seed_follow_up_templates`: vacía y reescribe las plantillas con un seed por defecto. Útil para "reset" tras experimentar.
- `wf_recompute_summaries`: regenera summaries de conversaciones pasadas con LLM.
- `wf_export_leads_csv`: exporta `lead_stages` filtrado a CSV (para Alex que quiera abrirlo en Excel todavía).

Botones en el dashboard que hacen `POST` al webhook de cada workflow.

## Roadmap del dashboard dentro del MVP

| Sprint | Funcionalidad |
|---|---|
| Sprint 1 | Endpoints admin de leads + Grafana con queries SQL básicas. NO admin web todavía. |
| Sprint 2 | Admin web: vistas de leads, notificaciones, marcar como visto. Plantillas editables. |
| Sprint 3 | Calendly webhook + flujo D + notificaciones de booking. |
| Sprint 4 | Dashboard de calidad del agente. Editor de system prompt. Export CSV. |

## Antipatrones del dashboard

❌ **Replicar lógica de funnel en el frontend**. El frontend solo muestra. La lógica de transiciones vive en Postgres + n8n.

❌ **Hacer el dashboard accesible al cliente final del cliente** (los closers). Por ahora solo Alex. Si hay que abrir, se diseña roles propio.

❌ **Cachear datos de leads en el frontend**. Cada vista hace fetch fresco. Los volúmenes son bajos.

❌ **Acoplar el admin a Postgres directamente**. Va vía API. Si mañana cambia el modelo, solo se toca un sitio.

❌ **Notificaciones por email/SMS/Telegram en MVP**. Solo dashboard. Cuando Alex pida móvil, evaluamos.
