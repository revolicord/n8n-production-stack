import {
  ESCALATING_CLASSES,
  type ManyChatWebhookEvent,
  ManyChatWebhookSchema,
  type MediaPolicy,
  classifyMediaType,
  classifyMessageContent,
  escalationReason,
} from '@dm-api/shared';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { getConfig } from '../config.js';
import { verifyMcToken } from '../lib/auth.js';
import { getDb } from '../lib/db.js';
import { buildIdempotencyHash } from '../lib/idempotency-hash.js';
import { doc, zodDoc } from '../lib/openapi.js';
import { getProcessBatchQueue } from '../lib/queue.js';
import { getRedis } from '../lib/redis.js';
import { type BufferMessage, debouncePush, getBufferLength } from '../services/debounce.js';
import { tryClaimIdempotency } from '../services/idempotency.js';
import { insertMessageRaw } from '../services/messages.js';
import {
  type NotificationKind,
  createNotification,
  tryClaimNotificationThrottle,
} from '../services/notifications.js';
import {
  getOrCreateSubscriber,
  isSubscriberActive,
  pauseSubscriber,
} from '../services/subscribers.js';
import { getTenantBySlug, parseTenantConfig } from '../services/tenants.js';

const IDEMPOTENCY_TTL_MS = 24 * 3600 * 1000;

/**
 * Acción efectiva para una content_class: el override del tenant gana; si no,
 * la allowlist por defecto (ESCALATING_CLASSES → 'escalate', resto → 'annotate').
 */
function effectiveAction(
  cls: string,
  mediaPolicy: MediaPolicy | undefined,
): 'escalate' | 'annotate' | 'agent' {
  const override = mediaPolicy?.[cls];
  if (override) return override;
  return (ESCALATING_CLASSES as readonly string[]).includes(cls) ? 'escalate' : 'annotate';
}

/**
 * Clasificación pura del trigger de escalado. Orden de prioridad:
 *  1. media[]: adjuntos explícitos (tipo declarado por ManyChat).
 *  2. classifyMessageContent(): captura URLs del CDN de IG en text[] cuando
 *     media[] está vacío (voice notes, imágenes enviadas así por ManyChat).
 *  3. keywords: solo sobre mensajes de texto puro.
 *
 * Exportada para tests; el match de keywords es por substring.
 */
export function matchEscalationTrigger(
  message: ManyChatWebhookEvent['message'],
  keywords: string[] | undefined,
  mediaPolicy?: MediaPolicy | undefined,
): { kind: NotificationKind; reason: string } | null {
  // 1. Adjuntos explícitos en media[]
  for (const m of message.media) {
    const cls = classifyMediaType(m.type);
    if (effectiveAction(cls, mediaPolicy) === 'escalate') {
      return { kind: cls as NotificationKind, reason: escalationReason(cls) };
    }
  }
  // 2. Clasificación completa del mensaje (captura CDN URLs en text[])
  const msgClass = classifyMessageContent(message);
  if (msgClass !== 'text' && (ESCALATING_CLASSES as readonly string[]).includes(msgClass)) {
    if (effectiveAction(msgClass, mediaPolicy) === 'escalate') {
      return { kind: msgClass as NotificationKind, reason: escalationReason(msgClass) };
    }
  }
  // 3. Keywords (solo texto legible)
  if (keywords && keywords.length > 0 && message.text && msgClass === 'text') {
    const text = message.text.toLowerCase();
    const matched = keywords.find((k) => k.trim() && text.includes(k.trim().toLowerCase()));
    if (matched) {
      return { kind: 'keyword', reason: `Palabra clave: "${matched}"` };
    }
  }
  return null;
}

/**
 * Detección determinista de escalado (audio / keywords del tenant). Corre
 * fire-and-forget tras persistir el mensaje: nunca bloquea ni rompe el ACK a
 * ManyChat; el throttle Redis evita spam en ráfagas del mismo tipo.
 */
async function detectEscalation(args: {
  tenantId: string;
  subscriberId: string;
  messageId: string;
  event: ManyChatWebhookEvent;
  keywords: string[] | undefined;
  mediaPolicy: MediaPolicy | undefined;
  log: FastifyBaseLogger;
}): Promise<void> {
  const { tenantId, subscriberId, messageId, event, keywords, mediaPolicy, log } = args;

  const trigger = matchEscalationTrigger(event.message, keywords, mediaPolicy);
  if (!trigger) return;
  const { kind, reason } = trigger;

  const fresh = await tryClaimNotificationThrottle(getRedis(), { tenantId, subscriberId, kind });
  if (!fresh) {
    log.debug({ subscriber_id: subscriberId, kind }, 'escalation throttled');
    return;
  }

  const notification = await createNotification(getDb(), {
    tenantId,
    subscriberId,
    kind,
    source: 'code',
    reason,
    summary: event.message.text ? event.message.text.slice(0, 300) : undefined,
    metadata: { message_id: messageId },
  });

  // Pausar al lead para que processBatchJob salte el dispatch al agente.
  // El agente no puede actuar sobre este contenido; el humano lo resuelve.
  await pauseSubscriber(getDb(), { subscriberId });

  log.info(
    { subscriber_id: subscriberId, kind, notification_id: notification.id },
    'escalation notification created — subscriber paused',
  );
}

export default async function webhookManyChatRoute(app: FastifyInstance): Promise<void> {
  const config = getConfig();

  app.post(
    '/webhook/manychat',
    doc({
      tags: ['webhooks'],
      summary: 'Mensaje entrante de un lead (ManyChat)',
      description:
        'Pipeline: auth x-mc-token → Zod → tenant → subscriber → idempotencia (SHA-256 + Redis SET NX) ' +
        '→ persistencia raw → detección de escalado (audio/keywords) → buffer Lua + job BullMQ con debounce. ' +
        'Responde 200 vacío también en duplicados, tenant inactivo o subscriber pausado (para que ManyChat no reintente).',
      security: [{ mcToken: [] }],
      body: zodDoc(ManyChatWebhookSchema),
    }),
    async (req, reply) => {
      // 1. Verify token (timing-safe)
      if (!verifyMcToken(req.headers['x-mc-token'], config.MC_WEBHOOK_TOKEN)) {
        return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
      }

      // 2. Parse + validate payload
      const parsed = ManyChatWebhookSchema.safeParse(req.body);
      if (!parsed.success) {
        req.log.warn({ issues: parsed.error.issues }, 'webhook payload invalid');
        return reply.code(400).send({
          error: { code: 'INVALID_PAYLOAD', details: parsed.error.issues },
        });
      }
      const event = parsed.data;

      // 3. Resolve tenant
      const tenant = await getTenantBySlug(getDb(), event.tenant_slug);
      if (!tenant || !tenant.isActive) {
        req.log.warn({ tenant_slug: event.tenant_slug }, 'tenant unknown or inactive');
        // 200 silencioso para que ManyChat no reintente
        return reply.code(200).send();
      }

      const tenantConfig = parseTenantConfig(tenant.config);
      const debounceMs = tenantConfig.debounce_ms ?? config.DEBOUNCE_MS;
      const maxWaitMs = tenantConfig.max_wait_ms ?? config.MAX_WAIT_MS;
      const hardLimit = tenantConfig.buffer_hard_limit ?? config.BUFFER_HARD_LIMIT;

      // 4. Get or create subscriber
      const subscriber = await getOrCreateSubscriber(getDb(), {
        tenantId: tenant.id,
        manychatSubscriberId: event.subscriber.manychat_id,
        igUserId: event.subscriber.ig_user_id,
        igUsername: event.subscriber.ig_username,
        displayName: event.subscriber.full_name ?? event.subscriber.name,
        locale: event.subscriber.locale,
        currentChannel: event.trigger?.channel,
        instagramContext: event.instagram_context,
      });

      // 5. Idempotency
      // If ManyChat doesn't send a message ID, generate one from subscriber + tenant + arrival ms
      const receivedAt = Date.now();
      const externalMessageId =
        event.message.id ?? `${event.subscriber.manychat_id}_${event.tenant_slug}_${receivedAt}`;
      const idempotencyHash = buildIdempotencyHash({
        tenantId: tenant.id,
        subscriberId: subscriber.id,
        externalMessageId,
      });
      const fresh = await tryClaimIdempotency(getRedis(), idempotencyHash, IDEMPOTENCY_TTL_MS);
      if (!fresh) {
        req.log.info({ idempotency_hash: idempotencyHash }, 'duplicate webhook, skipping');
        return reply.code(200).send();
      }

      // 6. Persist raw (audit-first, antes del ACK)
      const mediaUrls = event.message.media.map((m) => m.url);
      const messageRow = await insertMessageRaw(getDb(), {
        tenantId: tenant.id,
        subscriberId: subscriber.id,
        externalMessageId,
        idempotencyHash,
        direction: 'in',
        payload: event,
        text: event.message.text || null,
        mediaUrls,
        triggerSource: event.trigger?.source,
        triggerChannel: event.trigger?.channel,
        triggerRef: event.trigger?.ref,
      });

      // 7. Pausado/bloqueado: persistir-pero-no-despachar. El raw ya quedó en el
      // audit trail (paso 6); no empujamos al buffer, no encolamos BullMQ y no
      // escalamos (un humano ya está atendiendo). Al reactivar, el agente ve el
      // hueco vía handoff_state en vez de arrancar de cero.
      if (!isSubscriberActive(subscriber)) {
        req.log.info(
          { subscriber_id: subscriber.id, status: subscriber.status, message_id: messageRow.id },
          'subscriber inactive — persisted, not dispatched',
        );
        return reply.code(200).send();
      }

      // 7b. Escalado a humano (medios/keywords) — fire-and-forget, no bloquea el ACK
      void detectEscalation({
        tenantId: tenant.id,
        subscriberId: subscriber.id,
        messageId: messageRow.id,
        event,
        keywords: tenantConfig.notification_keywords,
        mediaPolicy: tenantConfig.media_policy,
        log: req.log,
      }).catch((err) => {
        req.log.error({ err }, 'escalation detection failed');
      });

      // 8. Push al buffer Redis (Lua atómico) + nuevo token
      const token = crypto.randomUUID();
      const now = Date.now();
      const contentClass = classifyMessageContent(event.message);
      const isEscalating = (ESCALATING_CLASSES as readonly string[]).includes(contentClass);
      const bufferMsg: BufferMessage = {
        id: messageRow.id,
        external_message_id: messageRow.externalMessageId,
        // Para contenido escalable (ej. voice note enviado como URL de CDN), text es la URL
        // del CDN — no es texto legible. Lo nulleamos para que process-batch use el placeholder
        // correcto (mediaPlaceholder) en vez de pasar la URL cruda al LLM.
        text: isEscalating ? null : messageRow.text,
        reply_type: event.message.reply_type ?? null,
        ts: now,
        media_urls: mediaUrls,
        content_class: contentClass,
      };

      const pushResult = await debouncePush(getRedis(), {
        tenantId: tenant.id,
        subscriberId: subscriber.id,
        message: bufferMsg,
        token,
        debounceMs,
        maxWaitMs,
        now,
      });

      // 9. Encolar BullMQ con delay
      const queue = getProcessBatchQueue();
      await queue.add(
        'process-batch',
        { tenantId: tenant.id, subscriberId: subscriber.id, token, reason: 'debounce' },
        {
          delay: debounceMs,
          jobId: `dbnc:${tenant.id}:${subscriber.id}:${token}`,
        },
      );

      // 10. Hard limit: dispatch inmediato si el buffer ya pasó el techo
      const bufferLen = await getBufferLength(getRedis(), {
        tenantId: tenant.id,
        subscriberId: subscriber.id,
      });
      if (bufferLen >= hardLimit) {
        await queue.add(
          'process-batch',
          {
            tenantId: tenant.id,
            subscriberId: subscriber.id,
            token,
            reason: 'hard_limit',
          },
          { jobId: `dbnc:${tenant.id}:${subscriber.id}:${token}:force` },
        );
        req.log.warn(
          { buffer_len: bufferLen, hard_limit: hardLimit },
          'buffer hard limit reached, forced dispatch',
        );
      }

      req.log.info(
        {
          tenant_id: tenant.id,
          subscriber_id: subscriber.id,
          message_id: messageRow.id,
          was_first: pushResult.wasFirst,
          buffer_len: bufferLen,
        },
        'webhook accepted',
      );

      return reply.code(200).send();
    },
  );
}
