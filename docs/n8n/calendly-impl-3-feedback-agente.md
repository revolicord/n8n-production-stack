# Frente 3 — Feedback humanizado (B2: evento de sistema → el agente responde)

**Parte de:** `docs/n8n/calendly-feedback-plan.md` (§6). **Decisión:** B2.
**Objetivo:** que tras marcar `D`, el AGENTE confirme la reserva con su voz y memoria — no un texto fijo.

## Enfoque: el evento viaja como un "mensaje especial" por el flujo normal

En vez de reconstruir el payload de agent-run a mano (B1, frágil), un endpoint nuevo mete el evento
en el **mismo flujo que un mensaje del lead**: buffer → `process-batch` (lock + `createTurn` +
`dispatchToN8n`) → agente → `turn-completed` (cierra el turno, libera lock). Reusa el 100% de la
maquinaria.

El evento es un `BufferMessage` con `reply_type: 'system_event'`. Build Context lo detecta y arma
`<system_event>` en vez de `<lead_message>`.

**Por qué es robusto con el lock:** si el lead está en un turno activo (lock tomado), `process-batch`
hace skip `'locked'`, pero el evento **queda en el buffer** → cuando ese turno termina,
`turn-completed` detecta mensajes pendientes y dispara el `post-lock-drain` → nuevo turno con el
evento. **No se pierde y no colisiona.** (Esto es lo que B1 no tenía.)

```
calendly-feedback (frente 2) → persist booking
   └─ Format datetime (Code)
        └─ HTTP POST /admin/leads/{id}/system-event   { event_type, detail }
              │
              ▼  (API)
        debouncePush(buffer, {reply_type:'system_event', text:detail})
        enqueue process-batch reason='system_event' (forzado)
              │
              ▼  worker (reusa todo)
        lock → createTurn → dispatch agent-run → agente confirma con su voz
              → turn-completed cierra el turno y libera lock
```

**Cero migración. El schema Zod no cambia** (`reply_type` ya es `z.string().nullable()`).

---

## A) Código en la API (lo escribo yo — cambios aditivos, bajo riesgo)

### A.1 `apps/api/src/lib/queue.ts` — añadir el reason
```ts
reason?: 'debounce' | 'hard_limit' | 'post_lock_drain' | 'system_event';
```

### A.2 `apps/api/src/workers/process-batch.ts` — marcar forzado (1 línea)
```ts
const isForced =
  reason === 'hard_limit' || reason === 'post_lock_drain' || reason === 'system_event';
```
Nada más cambia: el worker drena el buffer (incluye el evento), crea el turno, despacha. El evento
viaja en `messages` con `reply_type: 'system_event'`.

### A.3 `apps/api/src/routes/admin/system-event.ts` — endpoint nuevo
```ts
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getConfig } from '../../config.js';
import { verifyAdminAuth } from '../../lib/admin-auth.js';
import { getDb } from '../../lib/db.js';
import { getProcessBatchQueue } from '../../lib/queue.js';
import { getRedis } from '../../lib/redis.js';
import { debouncePush } from '../../services/debounce.js';
import { getSubscriberByUuid } from '../../services/subscribers.js';

const SystemEventBodySchema = z.object({
  event_type: z.string().min(1),
  detail: z.string().min(1),
});

export default async function systemEventRoute(app: FastifyInstance): Promise<void> {
  const config = getConfig();

  app.post<{ Params: { subscriberId: string } }>(
    '/admin/leads/:subscriberId/system-event',
    async (req, reply) => {
      if (!(await verifyAdminAuth(req, app))) {
        return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
      }
      const parsed = SystemEventBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: 'INVALID_PAYLOAD', details: parsed.error.issues } });
      }
      const { subscriberId } = req.params;
      const { event_type, detail } = parsed.data;

      const subscriber = await getSubscriberByUuid(getDb(), subscriberId);
      if (!subscriber) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }

      const now = Date.now();
      const token = randomUUID();
      // Evento como "mensaje especial" en el buffer; Build Context lo renderiza
      // como <system_event>. Si hay un turno activo, queda en el buffer y el
      // post-lock-drain lo recoge (no se pierde).
      await debouncePush(getRedis(), {
        tenantId: subscriber.tenantId,
        subscriberId: subscriber.id,
        message: {
          id: randomUUID(),
          external_message_id: null,
          text: `[${event_type}] ${detail}`,
          reply_type: 'system_event',
          ts: now,
          media_urls: [],
        },
        token,
        debounceMs: config.DEBOUNCE_MS,
        maxWaitMs: config.MAX_WAIT_MS,
        now,
      });

      await getProcessBatchQueue().add(
        'process-batch',
        { tenantId: subscriber.tenantId, subscriberId: subscriber.id, token, reason: 'system_event' },
        { delay: 0, jobId: `sysevt:${subscriber.tenantId}:${subscriber.id}:${token}` },
      );

      req.log.info({ subscriber_id: subscriberId, event_type }, 'system event enqueued');
      return reply.code(202).send({ accepted: true });
    },
  );
}
```

### A.4 `apps/api/src/routes/index.ts` — registrar la ruta
Seguir el patrón existente (verificar el archivo): `app.register(systemEventRoute)` junto a
`setStageRoute` / `turnCompletedRoute`.

### A.5 Tests `apps/api/src/routes/admin/system-event.test.ts`
- 401 sin auth · 400 body inválido · 404 subscriber inexistente · 202 happy path (verifica que
  `debouncePush` + `queue.add` se llamaron con `reason: 'system_event'`).

---

## B) Cambios en n8n (los aplicas tú)

### B.1 Build Context (`agent-run`) — detectar el evento
Añadir un helper y ramificar el `chatInput`. Reemplazar el bloque de `buildMessagesText` y la
construcción de `chatInput`:

```javascript
function buildMessagesText(messages) {
  return (messages || [])
    .filter(m => m.reply_type !== 'system_event')
    .map(function (m) {
      const rt = normalizeReplyType(m.reply_type);
      if (rt === 'thumbs_up') return '👍 [el contacto reacciono con pulgar arriba]';
      if (m.media_urls && m.media_urls.length > 0 && !m.text) return '[contenido multimedia recibido — no se puede leer]';
      return m.text || '[mensaje sin texto]';
    })
    .filter(Boolean)
    .join('\n');
}

function buildSystemEventText(messages) {
  return (messages || [])
    .filter(m => m.reply_type === 'system_event')
    .map(m => m.text || '')
    .filter(Boolean)
    .join('\n');
}
```

Y donde hoy se arma `chatInput`:
```javascript
const userMessages = buildMessagesText(body.messages);
const systemEventText = buildSystemEventText(body.messages);

let chatInput = '<context>\n' + JSON.stringify(contextJson, null, 2) + '\n</context>\n\n';
if (systemEventText) {
  chatInput += '<system_event>\n' + systemEventText + '\n</system_event>';
  if (userMessages) chatInput += '\n\n<lead_message>\n' + userMessages + '\n</lead_message>';
} else {
  chatInput += '<lead_message>\n' + userMessages + '\n</lead_message>';
}
```

### B.2 System prompt — regla para eventos de sistema
Añadir a `tenant.config.system_prompt` (y/o al Set node `System Prompt`):

```
# EVENTOS DE SISTEMA
A veces el input es un <system_event>, no un mensaje del lead. Actúa así:
- booking_confirmed: el lead acaba de agendar la llamada. Confírmaselo en UNA frase, seco y
  humano (ej: "Listo, te confirmé. Nos vemos el [día]."). NO uses set_stage, NO mandes contenido,
  NO repitas el link.
```

### B.3 Extender el workflow `calendly-feedback` (continúa el frente 2)
Tras `Persist Booking`:

**Nodo Format datetime (Code):**
```javascript
const p = $('Webhook').first().json.body.payload;
const start = (p.scheduled_event || {}).start_time;
const tz = p.timezone || 'America/Santo_Domingo';
const when = start
  ? new Intl.DateTimeFormat('es', {
      weekday: 'long', day: 'numeric', month: 'long',
      hour: '2-digit', minute: '2-digit', timeZone: tz,
    }).format(new Date(start))
  : 'la fecha acordada';
return [{ json: { ...$json, whenLocal: when } }];
```

**Nodo HTTP — disparar el evento:**
| Campo | Valor |
|-------|-------|
| Method | `POST` |
| URL | `=https://api.revolicord.com/admin/leads/{{ $('Get Subscriber').first().json.subscriber_id }}/system-event` |
| Auth | Bearer `{N8N_CALLBACK_TOKEN}` (misma credencial del set-stage) |
| Body (JSON) | `{ "event_type": "booking_confirmed", "detail": "agendó la llamada para {{ $json.whenLocal }}" }` |

---

## Checklist frente 3

**API (código):**
- [ ] `queue.ts`: añadir `'system_event'` al union `reason`.
- [ ] `process-batch.ts`: añadir `'system_event'` a `isForced`.
- [ ] `system-event.ts`: endpoint nuevo + registrar en `index.ts`.
- [ ] Tests del endpoint.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` en verde.

**n8n:**
- [ ] Build Context: `buildSystemEventText` + ramificar `chatInput`.
- [ ] System prompt: regla de eventos de sistema.
- [ ] Workflow `calendly-feedback`: Format datetime + HTTP a `/system-event`.

**Validación:**
- [ ] E2E: lead agenda → marca D (frente 2) → llega `system-event` → el agente manda UNA frase de
      confirmación con su voz por IG → queda en `n8n_chat_histories` → `turn-completed` cierra bien.
- [ ] Edge: lead escribiendo cuando llega el evento → no se pierde ni duplica (post-lock-drain).
- [ ] Verificar que el agente NO cambia etapa ni manda contenido ante el evento (regla del prompt).

---

## Notas
- **`event_type` extensible:** el mismo endpoint sirve a futuro para `reminder`, `no_show`,
  `booking_canceled` (2ª iteración) — solo se añade la regla correspondiente al prompt.
- **Por qué 202:** el endpoint encola y responde rápido; el trabajo real es async en el worker
  (igual que el webhook de ManyChat).
