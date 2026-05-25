import { db, followupTemplates, funnelStages, leadFollowupLog } from '@/lib/db';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { safeDivide } from './_helpers';

export type FollowupCell = {
  stageSlug: string;
  sequenceNumber: number;
  sent: number;
  responded: number;
  responseRate: number | null;
};

export async function getFollowupGrid(args: {
  tenantId: string;
  start: Date;
  end: Date;
}): Promise<FollowupCell[]> {
  const rows = await db
    .select({
      stageSlug: funnelStages.slug,
      sequenceNumber: followupTemplates.sequenceNumber,
      sent: sql<number>`COUNT(${leadFollowupLog.id})::int`,
      responded: sql<number>`COUNT(${leadFollowupLog.respondedAt})::int`,
    })
    .from(leadFollowupLog)
    .innerJoin(followupTemplates, eq(followupTemplates.id, leadFollowupLog.templateId))
    .innerJoin(funnelStages, eq(funnelStages.id, followupTemplates.stageId))
    .where(
      and(
        eq(leadFollowupLog.tenantId, args.tenantId),
        gte(leadFollowupLog.sentAt, args.start),
        lt(leadFollowupLog.sentAt, args.end),
      ),
    )
    .groupBy(funnelStages.slug, followupTemplates.sequenceNumber)
    .orderBy(funnelStages.slug, followupTemplates.sequenceNumber);

  return rows.map((r) => ({
    stageSlug: r.stageSlug,
    sequenceNumber: r.sequenceNumber,
    sent: r.sent,
    responded: r.responded,
    responseRate: safeDivide(r.responded, r.sent),
  }));
}
