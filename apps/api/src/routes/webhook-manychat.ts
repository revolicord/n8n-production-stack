import { type ManyChatWebhookEvent, ManyChatWebhookSchema } from '@dm-api/shared';
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
import { getOrCreateSubscriber, isSubscriberActive } from '../services/subscribers.js';
import { getTenantBySlug, parseTenantConfig } from '../services/tenants.js';

const IDEMPOTENCY_TTL_MS = 24 * 3600 * 1000;

/**
 * Clasificación pura del trigger de escalado: audio gana sobre keyword.
 * Exportada para tests; el match de keywords es por substring case-insensitive.
 */
export function matchEscalationTrigger(
  message: ManyChatWebhookEvent['message'],
  keywords: string[] | undefined,
): { kind: NotificationKind; reason: string } | null {
  if (message.media.some((m) => m.type === 'audio')) {
    return { kind: 'audio', reason: 'El lead envió un mensaje de audio' };
  }
  if (keywords && keywords.length > 0 && message.text) {
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
  log: FastifyBaseLogger;
}): Promise<void> {
  const { tenantId, subscriberId, messageId, event, keywords, log } = args;

  const trigger = matchEscalationTrigger(event.message, keywords);
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
  log.info(
    { subscriber_id: subscriberId, kind, notification_id: notification.id },
    'escalation notification created',
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

      // 5. Skip if paused/blocked
      if (!isSubscriberActive(subscriber)) {
        req.log.info(
          { subscriber_id: subscriber.id, status: subscriber.status },
          'subscriber inactive, skipping',
        );
        return reply.code(200).send();
      }

      // 6. Idempotency
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

      // 7. Persist raw (audit-first, antes del ACK)
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

      // 7b. Escalado a humano (audio/keywords) — fire-and-forget, no bloquea el ACK
      void detectEscalation({
        tenantId: tenant.id,
        subscriberId: subscriber.id,
        messageId: messageRow.id,
        event,
        keywords: tenantConfig.notification_keywords,
        log: req.log,
      }).catch((err) => {
        req.log.error({ err }, 'escalation detection failed');
      });

      // 8. Push al buffer Redis (Lua atómico) + nuevo token
      const token = crypto.randomUUID();
      const now = Date.now();
      const bufferMsg: BufferMessage = {
        id: messageRow.id,
        external_message_id: messageRow.externalMessageId,
        text: messageRow.text,
        reply_type: event.message.reply_type ?? null,
        ts: now,
        media_urls: mediaUrls,
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
