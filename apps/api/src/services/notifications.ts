import { type DbClient, type Notification, notifications } from '@dm-api/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { getNotifyQueue } from '../lib/queue.js';
import { redisKeys } from '../lib/redis-keys.js';

// 'audio'|'image'|'video'|'location'|'file'|'unknown' = escalado determinista
// por content_class (medios sobre los que el agente no puede actuar todavía).
// 'keyword' = frase del tenant. 'agent' = el propio agente pidió notify_human.
export type NotificationKind =
  | 'audio'
  | 'image'
  | 'video'
  | 'location'
  | 'file'
  | 'unknown'
  | 'keyword'
  | 'agent';
export type NotificationSource = 'code' | 'agent';

/** TTL del throttle por (tenant, subscriber, kind): evita spam en ráfagas. */
const THROTTLE_TTL_SECONDS = 600;

/**
 * Claim atómico del throttle (SET NX + TTL). Devuelve true si esta llamada
 * ganó la ventana y debe crear la notificación; false si ya hay una reciente
 * del mismo tipo para este lead.
 */
export async function tryClaimNotificationThrottle(
  redis: Redis,
  args: { tenantId: string; subscriberId: string; kind: NotificationKind },
  ttlSeconds: number = THROTTLE_TTL_SECONDS,
): Promise<boolean> {
  const key = redisKeys.notif(args.tenantId, args.subscriberId, args.kind);
  const result = await redis.set(key, '1', 'EX', ttlSeconds, 'NX');
  return result === 'OK';
}

/**
 * Inserta la notificación y encola el job 'notify' que la entrega a Telegram.
 * La entrega es asíncrona y con reintentos (BullMQ); si Telegram no está
 * configurado la fila queda igualmente visible en el dashboard.
 */
export async function createNotification(
  db: DbClient,
  args: {
    tenantId: string;
    subscriberId: string;
    conversationId?: string | undefined;
    turnId?: string | undefined;
    kind: NotificationKind;
    source: NotificationSource;
    reason?: string | undefined;
    summary?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  },
): Promise<Notification> {
  const [row] = await db
    .insert(notifications)
    .values({
      tenantId: args.tenantId,
      subscriberId: args.subscriberId,
      conversationId: args.conversationId,
      turnId: args.turnId,
      kind: args.kind,
      source: args.source,
      reason: args.reason,
      summary: args.summary,
      metadata: args.metadata ?? {},
    })
    .returning();

  if (!row) {
    throw new Error('notifications insert returned no row');
  }

  await getNotifyQueue().add('notify', { notificationId: row.id }, { jobId: `notif:${row.id}` });

  return row;
}

export async function getNotificationById(db: DbClient, id: string): Promise<Notification | null> {
  const rows = await db.select().from(notifications).where(eq(notifications.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function resolveNotification(
  db: DbClient,
  args: { id: string; resolvedBy: string; note?: string | undefined },
): Promise<Notification | null> {
  // La nota del humano se guarda como `summary` para que el agente la vea en
  // handoff_state al retomar (contexto de qué pasó durante la intervención).
  const set: Record<string, unknown> = {
    status: 'resolved',
    resolvedAt: sql`now()`,
    resolvedBy: args.resolvedBy,
  };
  if (args.note && args.note.trim() !== '') {
    set.summary = args.note.trim();
  }
  const rows = await db
    .update(notifications)
    .set(set)
    .where(and(eq(notifications.id, args.id), eq(notifications.status, 'pending')))
    .returning();
  return rows[0] ?? null;
}

export async function listNotifications(
  db: DbClient,
  args: { tenantId: string; status?: 'pending' | 'resolved' | undefined; limit?: number },
): Promise<Notification[]> {
  const conditions = [eq(notifications.tenantId, args.tenantId)];
  if (args.status) {
    conditions.push(eq(notifications.status, args.status));
  }
  return db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(args.limit ?? 100);
}

export async function countPendingNotifications(db: DbClient, tenantId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.tenantId, tenantId), eq(notifications.status, 'pending')));
  return Number(rows[0]?.n ?? 0);
}

/** Guarda chat/message id de Telegram para poder editar el mensaje al resolver. */
export async function setTelegramRef(
  db: DbClient,
  args: { id: string; chatId: string; messageId: string },
): Promise<void> {
  await db
    .update(notifications)
    .set({ telegramChatId: args.chatId, telegramMessageId: args.messageId })
    .where(eq(notifications.id, args.id));
}
