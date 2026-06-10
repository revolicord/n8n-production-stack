import { db, notifications, subscribers } from '@/lib/db';
import { and, desc, eq, sql } from 'drizzle-orm';

/** Notificación de escalado enriquecida con los datos del lead para la UI. */
export interface EscalationRow {
  id: string;
  kind: string; // 'audio' | 'keyword' | 'agent'
  source: string;
  reason: string | null;
  summary: string | null;
  status: string; // 'pending' | 'resolved'
  createdAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  subscriberId: string;
  displayName: string | null;
  igUsername: string | null;
  /** Estado actual del lead: si está pausado se muestra en rojo + botón reanudar. */
  subscriberStatus: string;
  pausedUntil: Date | null;
}

export async function getEscalations(args: {
  tenantId: string;
  status?: 'pending' | 'resolved';
  limit?: number;
}): Promise<EscalationRow[]> {
  const conditions = [eq(notifications.tenantId, args.tenantId)];
  if (args.status) conditions.push(eq(notifications.status, args.status));

  return db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      source: notifications.source,
      reason: notifications.reason,
      summary: notifications.summary,
      status: notifications.status,
      createdAt: notifications.createdAt,
      resolvedAt: notifications.resolvedAt,
      resolvedBy: notifications.resolvedBy,
      subscriberId: notifications.subscriberId,
      displayName: subscribers.displayName,
      igUsername: subscribers.igUsername,
      subscriberStatus: subscribers.status,
      pausedUntil: subscribers.pausedUntil,
    })
    .from(notifications)
    .innerJoin(subscribers, eq(subscribers.id, notifications.subscriberId))
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(args.limit ?? 200);
}

export async function getPendingEscalationsCount(tenantId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.tenantId, tenantId), eq(notifications.status, 'pending')));
  return Number(rows[0]?.n ?? 0);
}

/** Leads del tenant con pausa vigente (indefinida o no expirada). */
export async function getPausedLeadsCount(tenantId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(subscribers)
    .where(
      and(
        eq(subscribers.tenantId, tenantId),
        eq(subscribers.status, 'paused'),
        sql`(${subscribers.pausedUntil} IS NULL OR ${subscribers.pausedUntil} > now())`,
      ),
    );
  return Number(rows[0]?.n ?? 0);
}
