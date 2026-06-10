import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyAdminAuth } from '../../lib/admin-auth.js';
import { getDb } from '../../lib/db.js';
import { adminSecurity, doc, uuidParams, zodDoc } from '../../lib/openapi.js';
import { getRedis } from '../../lib/redis.js';
import { createNotification, tryClaimNotificationThrottle } from '../../services/notifications.js';
import { getSubscriberByUuid } from '../../services/subscribers.js';

/**
 * Body de POST /admin/leads/:subscriberId/notify-human.
 *
 * `reason` es el motivo corto del escalado (ej. "lead pide hablar con una
 * persona") y `summary` un resumen opcional de la conversación para que el
 * humano entre con contexto.
 */
export const NotifyHumanBodySchema = z.object({
  reason: z.string().min(1),
  summary: z.string().optional(),
  turn_id: z.string().uuid().optional(),
  conversation_id: z.string().uuid().optional(),
});

/**
 * Tool semántico `notify_human` del agente n8n: cuando el agente decide que
 * la conversación necesita un humano (lead lo pide, agresividad, incertidumbre
 * alta), llama aquí y se crea una notificación kind='agent' que el worker
 * entrega a Telegram. No pausa al lead: la pausa es decisión del humano
 * (botón de Telegram o dashboard).
 */
export default async function notifyHumanRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { subscriberId: string } }>(
    '/admin/leads/:subscriberId/notify-human',
    doc({
      tags: ['admin/leads'],
      summary: 'Escalar la conversación a un humano (tool notify_human)',
      description:
        'Crea una notificación kind=agent que el worker entrega a Telegram. No pausa al lead. ' +
        'Throttle de 10 min compartido con la detección determinista (202 con throttled=true si aplica).',
      security: adminSecurity,
      params: uuidParams('subscriberId'),
      body: zodDoc(NotifyHumanBodySchema),
    }),
    async (req, reply) => {
      if (!(await verifyAdminAuth(req, app))) {
        return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
      }

      const parsed = NotifyHumanBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: { code: 'INVALID_PAYLOAD', details: parsed.error.issues },
        });
      }

      const subscriber = await getSubscriberByUuid(getDb(), req.params.subscriberId);
      if (!subscriber) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }

      // Throttle compartido con la detección determinista: si el agente ya
      // escaló este lead hace <10 min, no duplicamos la alerta.
      const fresh = await tryClaimNotificationThrottle(getRedis(), {
        tenantId: subscriber.tenantId,
        subscriberId: subscriber.id,
        kind: 'agent',
      });
      if (!fresh) {
        req.log.info({ subscriber_id: subscriber.id }, 'agent escalation throttled');
        return reply.code(202).send({ accepted: true, throttled: true });
      }

      const notification = await createNotification(getDb(), {
        tenantId: subscriber.tenantId,
        subscriberId: subscriber.id,
        conversationId: parsed.data.conversation_id,
        turnId: parsed.data.turn_id,
        kind: 'agent',
        source: 'agent',
        reason: parsed.data.reason,
        summary: parsed.data.summary,
      });

      req.log.info(
        { subscriber_id: subscriber.id, notification_id: notification.id },
        'agent escalation created',
      );
      return reply.code(202).send({ accepted: true, notification_id: notification.id });
    },
  );
}
