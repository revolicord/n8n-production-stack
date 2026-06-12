import type { Job } from 'bullmq';
import { getConfig } from '../config.js';
import { getDb } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import type { NotifyJobData } from '../lib/queue.js';
import { type TelegramInlineButton, escapeHtml, sendMessage } from '../lib/telegram.js';
import { getLeadStage } from '../services/lead-stages.js';
import { getNotificationById, setTelegramRef } from '../services/notifications.js';
import { getSubscriberByUuid } from '../services/subscribers.js';
import { getTenantById, parseTenantConfig } from '../services/tenants.js';

export interface NotifyResult {
  status: 'sent' | 'skipped';
  reason?: string;
}

const KIND_HEADERS: Record<string, string> = {
  audio: '🎙 <b>Audio recibido</b>',
  image: '🖼 <b>Imagen recibida</b>',
  video: '🎬 <b>Video recibido</b>',
  location: '📍 <b>Ubicación compartida</b>',
  file: '📎 <b>Archivo recibido</b>',
  unknown: '❓ <b>Contenido no soportado</b>',
  keyword: '🚨 <b>Palabra clave detectada</b>',
  agent: '🤖 <b>El agente pide un humano</b>',
};

/** Botones del estado pendiente: pausar el bot para el lead o dar por resuelto. */
export function pendingButtons(notificationId: string): TelegramInlineButton[][] {
  return [
    [
      { text: '⏸ Pausar bot', callback_data: `pause:${notificationId}` },
      { text: '✅ Resuelto', callback_data: `resolve:${notificationId}` },
    ],
  ];
}

/**
 * Entrega una notificación de escalado a Telegram. El chat destino sale de
 * tenant.config.telegram_chat_id con fallback a TELEGRAM_DEFAULT_CHAT_ID.
 * Sin chat o sin bot token la entrega se omite sin fallar (la fila ya está
 * en DB y el dashboard la muestra igual).
 */
export async function notifyJob(job: Job<NotifyJobData>): Promise<NotifyResult> {
  const { notificationId } = job.data;
  const config = getConfig();
  const log = logger().child({ job_id: job.id, notification_id: notificationId });
  const db = getDb();

  const notification = await getNotificationById(db, notificationId);
  if (!notification) {
    log.warn('notification not found, skipping');
    return { status: 'skipped', reason: 'not_found' };
  }
  if (notification.status !== 'pending') {
    return { status: 'skipped', reason: 'already_resolved' };
  }
  if (notification.telegramMessageId) {
    return { status: 'skipped', reason: 'already_sent' };
  }

  const subscriber = await getSubscriberByUuid(db, notification.subscriberId);
  if (!subscriber) {
    log.warn('subscriber not found, skipping');
    return { status: 'skipped', reason: 'subscriber_not_found' };
  }

  const tenant = await getTenantById(db, notification.tenantId);
  const tenantConfig = tenant ? parseTenantConfig(tenant.config) : {};
  const chatId = tenantConfig.telegram_chat_id ?? config.TELEGRAM_DEFAULT_CHAT_ID;
  if (!chatId || !config.TELEGRAM_BOT_TOKEN) {
    log.warn('telegram chat/token not configured, notification stays db-only');
    return { status: 'skipped', reason: 'telegram_not_configured' };
  }

  const stage = await getLeadStage(db, {
    tenantId: notification.tenantId,
    subscriberId: notification.subscriberId,
  });

  const name = subscriber.displayName ?? subscriber.igUsername ?? subscriber.id;
  const lines = [
    KIND_HEADERS[notification.kind] ?? `🔔 <b>${escapeHtml(notification.kind)}</b>`,
    '',
    `Lead: <b>${escapeHtml(name)}</b>${subscriber.igUsername ? ` (@${escapeHtml(subscriber.igUsername)})` : ''}`,
    `Etapa: ${escapeHtml(stage)}`,
  ];
  if (notification.reason) lines.push(`Motivo: ${escapeHtml(notification.reason)}`);
  if (notification.summary) lines.push(`Resumen: ${escapeHtml(notification.summary)}`);
  if (subscriber.igUsername) {
    lines.push(`IG: https://instagram.com/${escapeHtml(subscriber.igUsername)}`);
  }
  if (config.DASHBOARD_PUBLIC_URL) {
    const deepLink = subscriber.igUsername
      ? `${config.DASHBOARD_PUBLIC_URL}/prospects?q=${encodeURIComponent(subscriber.igUsername)}`
      : `${config.DASHBOARD_PUBLIC_URL}/escalaciones`;
    lines.push(`Panel: ${deepLink}`);
  }

  const sent = await sendMessage({
    chatId,
    text: lines.join('\n'),
    buttons: pendingButtons(notification.id),
  });
  if (!sent) {
    return { status: 'skipped', reason: 'telegram_not_configured' };
  }

  await setTelegramRef(db, {
    id: notification.id,
    chatId: sent.chatId,
    messageId: sent.messageId,
  });

  log.info({ chat_id: sent.chatId, message_id: sent.messageId }, 'escalation sent to telegram');
  return { status: 'sent' };
}
