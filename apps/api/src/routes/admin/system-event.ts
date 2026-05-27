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

/**
 * Body de POST /admin/leads/:subscriberId/system-event.
 *
 * `event_type` es el tipo de evento de sistema (ej. `booking_confirmed`) y
 * `detail` es el texto que verá el agente dentro de `<system_event>`.
 */
export const SystemEventBodySchema = z.object({
  event_type: z.string().min(1),
  detail: z.string().min(1),
});

/**
 * Disparador de "eventos de sistema" hacia el agente.
 *
 * A diferencia de un mensaje del lead, este evento no viene de ManyChat: lo
 * dispara un actor externo (ej. el workflow `calendly-feedback` cuando un lead
 * reserva). En vez de reconstruir el payload de agent-run a mano, metemos el
 * evento como un `BufferMessage` con `reply_type: 'system_event'` en el flujo
 * normal del worker. Así reusa toda la maquinaria (lock de turno, createTurn,
 * dispatch a n8n, turn-completed) sin turnos huérfanos.
 *
 * El `reason: 'system_event'` es forzado en process-batch, así que se procesa
 * de inmediato sin esperar el debounce. Si hay un turno activo (lock tomado),
 * el worker hace skip 'locked' y el evento queda en el buffer; el
 * post-lock-drain de turn-completed lo recoge al cerrar el turno en curso.
 *
 * Build Context (n8n) detecta `reply_type === 'system_event'` y lo renderiza
 * como `<system_event>` en vez de `<lead_message>`.
 */
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
        return reply.code(400).send({
          error: { code: 'INVALID_PAYLOAD', details: parsed.error.issues },
        });
      }

      const { subscriberId } = req.params;
      const { event_type, detail } = parsed.data;

      const subscriber = await getSubscriberByUuid(getDb(), subscriberId);
      if (!subscriber) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }

      const now = Date.now();
      const token = randomUUID();

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
        {
          tenantId: subscriber.tenantId,
          subscriberId: subscriber.id,
          token,
          reason: 'system_event',
        },
        {
          delay: 0,
          jobId: `sysevt:${subscriber.tenantId}:${subscriber.id}:${token}`,
        },
      );

      req.log.info({ subscriber_id: subscriberId, event_type }, 'system event enqueued');
      return reply.code(202).send({ accepted: true });
    },
  );
}
