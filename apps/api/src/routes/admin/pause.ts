import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyAdminAuth } from '../../lib/admin-auth.js';
import { getDb } from '../../lib/db.js';
import { adminSecurity, doc, uuidParams, zodDoc } from '../../lib/openapi.js';
import { getRedis } from '../../lib/redis.js';
import { releaseNotificationThrottles } from '../../services/notifications.js';
import {
  getSubscriberByUuid,
  pauseSubscriber,
  resumeSubscriber,
} from '../../services/subscribers.js';

const PauseBodySchema = z.object({
  // Minutos de pausa; sin valor = pausa indefinida hasta reanudar manual.
  duration_minutes: z.number().int().positive().optional(),
});

/**
 * Pausa/reanudación manual del bot por lead (escalado a humano). El pausado
 * lo respeta isSubscriberActive() antes del dispatch: con status='paused' el
 * webhook hace skip y el lead no recibe respuestas del agente.
 */
export default async function pauseRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { subscriberId: string } }>(
    '/admin/leads/:subscriberId/pause',
    doc({
      tags: ['admin/leads'],
      summary: 'Pausar el bot para un lead',
      description:
        'Con status=paused el webhook hace skip y el lead no recibe respuestas del agente. ' +
        'Sin duration_minutes la pausa es indefinida hasta reanudar manualmente.',
      security: adminSecurity,
      params: uuidParams('subscriberId'),
      body: zodDoc(PauseBodySchema),
    }),
    async (req, reply) => {
      if (!(await verifyAdminAuth(req, app))) {
        return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
      }
      const parsed = PauseBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: { code: 'INVALID_PAYLOAD', details: parsed.error.issues },
        });
      }

      const subscriber = await getSubscriberByUuid(getDb(), req.params.subscriberId);
      if (!subscriber) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }

      const pausedUntil = parsed.data.duration_minutes
        ? new Date(Date.now() + parsed.data.duration_minutes * 60_000)
        : null;
      const updated = await pauseSubscriber(getDb(), {
        subscriberId: subscriber.id,
        pausedUntil,
      });

      req.log.info(
        { subscriber_id: subscriber.id, paused_until: pausedUntil },
        'subscriber paused',
      );
      return reply.send({ subscriber: updated });
    },
  );

  app.post<{ Params: { subscriberId: string } }>(
    '/admin/leads/:subscriberId/resume',
    doc({
      tags: ['admin/leads'],
      summary: 'Reanudar el bot para un lead',
      security: adminSecurity,
      params: uuidParams('subscriberId'),
    }),
    async (req, reply) => {
      if (!(await verifyAdminAuth(req, app))) {
        return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
      }

      const subscriber = await getSubscriberByUuid(getDb(), req.params.subscriberId);
      if (!subscriber) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }

      const updated = await resumeSubscriber(getDb(), { subscriberId: subscriber.id });
      // Limpiar throttles: la próxima escalación del mismo tipo debe re-pausar.
      await releaseNotificationThrottles(getRedis(), {
        tenantId: subscriber.tenantId,
        subscriberId: subscriber.id,
      });
      req.log.info({ subscriber_id: subscriber.id }, 'subscriber resumed');
      return reply.send({ subscriber: updated });
    },
  );
}
