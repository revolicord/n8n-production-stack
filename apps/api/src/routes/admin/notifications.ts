import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyAdminAuth } from '../../lib/admin-auth.js';
import { getDb } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { adminSecurity, doc, uuidParams, zodDoc } from '../../lib/openapi.js';
import { getRedis } from '../../lib/redis.js';
import { editMessageText, escapeHtml } from '../../lib/telegram.js';
import {
  getNotificationById,
  listNotifications,
  releaseNotificationThrottles,
  resolveNotification,
} from '../../services/notifications.js';
import { maybeResumeAgentConversation } from '../../services/resume-agent.js';
import { getSubscriberByUuid, resumeSubscriber } from '../../services/subscribers.js';

const ListQuerySchema = z.object({
  tenant_id: z.string().uuid(),
  status: z.enum(['pending', 'resolved']).optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
});

const ResolveBodySchema = z.object({
  resolved_by: z.string().min(1).default('dashboard'),
  // Si true, además reanuda al lead (status='active').
  resume: z.boolean().default(false),
  // Nota opcional de una línea: se guarda como summary del handoff para que el
  // agente la vea al retomar la conversación.
  note: z.string().max(500).optional(),
});

/**
 * Gestión de notificaciones de escalado (consumidas por el dashboard vía el
 * proxy /api/admin/*): listar y resolver. Al resolver se intenta editar el
 * mensaje original de Telegram para reflejar el estado (best-effort).
 */
export default async function notificationsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/admin/notifications',
    doc({
      tags: ['admin/notifications'],
      summary: 'Listar notificaciones de escalado',
      security: adminSecurity,
      querystring: zodDoc(ListQuerySchema),
    }),
    async (req, reply) => {
      if (!(await verifyAdminAuth(req, app))) {
        return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
      }
      const parsed = ListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send({
          error: { code: 'INVALID_QUERY', details: parsed.error.issues },
        });
      }
      const { tenant_id, status, limit } = parsed.data;
      const items = await listNotifications(getDb(), { tenantId: tenant_id, status, limit });
      return reply.send({ notifications: items });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/admin/notifications/:id/resolve',
    doc({
      tags: ['admin/notifications'],
      summary: 'Resolver una notificación (idempotente)',
      description:
        'Marca la notificación como resuelta; con resume=true además reanuda al lead. ' +
        'Best-effort: edita el mensaje original de Telegram para reflejar el estado.',
      security: adminSecurity,
      params: uuidParams('id'),
      body: zodDoc(ResolveBodySchema),
    }),
    async (req, reply) => {
      if (!(await verifyAdminAuth(req, app))) {
        return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
      }
      const parsed = ResolveBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: { code: 'INVALID_PAYLOAD', details: parsed.error.issues },
        });
      }

      const existing = await getNotificationById(getDb(), req.params.id);
      if (!existing) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }

      const resolved = await resolveNotification(getDb(), {
        id: req.params.id,
        resolvedBy: parsed.data.resolved_by,
        note: parsed.data.note,
      });
      if (!resolved) {
        // Ya estaba resuelta: idempotente, devolvemos el estado actual.
        return reply.send({ notification: existing });
      }

      if (parsed.data.resume) {
        await resumeSubscriber(getDb(), { subscriberId: resolved.subscriberId });
        await releaseNotificationThrottles(getRedis(), {
          tenantId: resolved.tenantId,
          subscriberId: resolved.subscriberId,
        });
        await maybeResumeAgentConversation(getDb(), {
          tenantId: resolved.tenantId,
          subscriberId: resolved.subscriberId,
          conversationId: resolved.conversationId,
          note: parsed.data.note ?? '',
          resolvedBy: parsed.data.resolved_by,
          notificationId: resolved.id,
          log: logger(),
        });
      }

      // Best-effort: reflejar el estado en el mensaje de Telegram original.
      if (resolved.telegramChatId && resolved.telegramMessageId) {
        try {
          const subscriber = await getSubscriberByUuid(getDb(), resolved.subscriberId);
          const name = subscriber?.displayName ?? subscriber?.igUsername ?? resolved.subscriberId;
          await editMessageText({
            chatId: resolved.telegramChatId,
            messageId: resolved.telegramMessageId,
            text: `✅ <b>Resuelto</b> por ${escapeHtml(parsed.data.resolved_by)} — lead ${escapeHtml(name)}${subscriber?.igUsername ? ` (@${escapeHtml(subscriber.igUsername)})` : ''}`,
          });
        } catch (err) {
          req.log.warn({ err }, 'failed to edit telegram message on resolve');
        }
      }

      req.log.info({ notification_id: resolved.id }, 'notification resolved');
      return reply.send({ notification: resolved });
    },
  );
}
