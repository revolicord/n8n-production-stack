import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getConfig } from '../config.js';
import { verifyMcToken } from '../lib/auth.js';
import { getDb } from '../lib/db.js';
import { doc, zodDoc } from '../lib/openapi.js';
import {
  type TelegramInlineButton,
  answerCallbackQuery,
  editMessageReplyMarkup,
} from '../lib/telegram.js';
import { getNotificationById, resolveNotification } from '../services/notifications.js';
import { pauseSubscriber, resumeSubscriber } from '../services/subscribers.js';
import { pendingButtons } from '../workers/notify.js';

const TelegramUpdateSchema = z.object({
  callback_query: z
    .object({
      id: z.string(),
      data: z.string().optional(),
      from: z
        .object({
          username: z.string().optional(),
          first_name: z.string().optional(),
        })
        .optional(),
      message: z
        .object({
          message_id: z.number(),
          chat: z.object({ id: z.union([z.number(), z.string()]) }),
        })
        .optional(),
    })
    .optional(),
});

/**
 * Callbacks de los botones inline de las alertas de escalado:
 * `pause:<notificationId>` / `resume:<notificationId>` / `resolve:<notificationId>`.
 *
 * Telegram manda el secreto configurado en setWebhook en el header
 * `X-Telegram-Bot-Api-Secret-Token`; sin match (o sin secreto configurado)
 * se rechaza. Registrar una vez con scripts/telegram-set-webhook.sh.
 * Siempre respondemos 200 a updates válidos para que Telegram no reintente.
 */
export default async function webhookTelegramRoute(app: FastifyInstance): Promise<void> {
  const config = getConfig();

  app.post(
    '/webhook/telegram',
    doc({
      tags: ['webhooks'],
      summary: 'Callbacks de botones inline de Telegram',
      description:
        'Procesa `pause:<id>` / `resume:<id>` / `resolve:<id>` de las alertas de escalado. ' +
        'Updates sin callback_query se ignoran con 200.',
      security: [{ telegramSecret: [] }],
      body: zodDoc(TelegramUpdateSchema),
    }),
    async (req, reply) => {
      if (
        !config.TELEGRAM_WEBHOOK_SECRET ||
        !verifyMcToken(
          req.headers['x-telegram-bot-api-secret-token'],
          config.TELEGRAM_WEBHOOK_SECRET,
        )
      ) {
        return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
      }

      const parsed = TelegramUpdateSchema.safeParse(req.body);
      const cb = parsed.success ? parsed.data.callback_query : undefined;
      if (!cb?.data) {
        // Update sin callback (mensajes al bot, etc.): lo ignoramos.
        return reply.code(200).send();
      }

      const [action, notificationId] = cb.data.split(':');
      if (!notificationId || !['pause', 'resume', 'resolve'].includes(action ?? '')) {
        await answerCallbackQuery({ callbackQueryId: cb.id, text: 'Acción desconocida' });
        return reply.code(200).send();
      }

      const notification = await getNotificationById(getDb(), notificationId);
      if (!notification) {
        await answerCallbackQuery({ callbackQueryId: cb.id, text: 'Notificación no encontrada' });
        return reply.code(200).send();
      }

      const actor = cb.from?.username ?? cb.from?.first_name ?? 'telegram';
      let toast = '';
      let buttons: TelegramInlineButton[][] | null = null;

      if (action === 'pause') {
        await pauseSubscriber(getDb(), { subscriberId: notification.subscriberId });
        toast = '⏸ Bot pausado para este lead';
        buttons = [
          [
            { text: '▶️ Reanudar bot', callback_data: `resume:${notification.id}` },
            { text: '✅ Resuelto', callback_data: `resolve:${notification.id}` },
          ],
        ];
      } else if (action === 'resume') {
        await resumeSubscriber(getDb(), { subscriberId: notification.subscriberId });
        toast = '▶️ Bot reanudado para este lead';
        buttons = pendingButtons(notification.id);
      } else {
        await resolveNotification(getDb(), {
          id: notification.id,
          resolvedBy: `telegram:${actor}`,
        });
        toast = '✅ Notificación resuelta';
        buttons = []; // sin botones: estado terminal
      }

      await answerCallbackQuery({ callbackQueryId: cb.id, text: toast });

      // Actualizar los botones del mensaje original (best-effort).
      const chatId = notification.telegramChatId ?? String(cb.message?.chat.id ?? '');
      const messageId = notification.telegramMessageId ?? String(cb.message?.message_id ?? '');
      if (chatId && messageId) {
        try {
          await editMessageReplyMarkup({ chatId, messageId, buttons });
        } catch (err) {
          req.log.warn({ err }, 'failed to edit telegram reply markup');
        }
      }

      req.log.info(
        { notification_id: notification.id, action, actor },
        'telegram callback processed',
      );
      return reply.code(200).send();
    },
  );
}
