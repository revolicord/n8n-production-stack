import {
  type DbClient,
  type FollowupTemplate,
  type FunnelStage,
  type LeadFollowupLog,
  followupTemplates,
  funnelStages,
  leadFollowupLog,
} from '@dm-api/db';
import { and, asc, desc, eq } from 'drizzle-orm';

export async function getFunnelStageById(
  db: DbClient,
  stageId: string,
): Promise<{ id: string; tenantId: string } | null> {
  const rows = await db
    .select({ id: funnelStages.id, tenantId: funnelStages.tenantId })
    .from(funnelStages)
    .where(eq(funnelStages.id, stageId))
    .limit(1);
  return rows[0] ?? null;
}

export async function listFollowupTemplatesByStage(
  db: DbClient,
  args: { stageId: string; includeInactive?: boolean },
): Promise<FollowupTemplate[]> {
  const condition = args.includeInactive
    ? eq(followupTemplates.stageId, args.stageId)
    : and(eq(followupTemplates.stageId, args.stageId), eq(followupTemplates.isActive, true));

  return db
    .select()
    .from(followupTemplates)
    .where(condition)
    .orderBy(asc(followupTemplates.sequenceNumber));
}

export async function createFollowupTemplate(
  db: DbClient,
  args: {
    stageId: string;
    tenantId: string;
    sequenceNumber: number;
    delayMinutes: number;
    type: string;
    textTemplate?: string | null;
    flowNs?: string | null;
    description?: string | null;
  },
): Promise<FollowupTemplate> {
  const [row] = await db
    .insert(followupTemplates)
    .values({
      stageId: args.stageId,
      tenantId: args.tenantId,
      sequenceNumber: args.sequenceNumber,
      delayMinutes: args.delayMinutes,
      type: args.type,
      textTemplate: args.textTemplate ?? null,
      flowNs: args.flowNs ?? null,
      description: args.description ?? null,
    })
    .returning();

  if (!row) throw new Error('followup_templates insert returned no row');
  return row;
}

export async function getFollowupTemplateById(
  db: DbClient,
  id: string,
): Promise<FollowupTemplate | null> {
  const rows = await db
    .select()
    .from(followupTemplates)
    .where(eq(followupTemplates.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateFollowupTemplate(
  db: DbClient,
  id: string,
  patch: Partial<{
    sequenceNumber: number;
    delayMinutes: number;
    type: string;
    textTemplate: string | null;
    flowNs: string | null;
    description: string | null;
  }>,
): Promise<FollowupTemplate | null> {
  const rows = await db
    .update(followupTemplates)
    .set(patch)
    .where(eq(followupTemplates.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function deactivateFollowupTemplate(
  db: DbClient,
  id: string,
): Promise<FollowupTemplate | null> {
  const rows = await db
    .update(followupTemplates)
    .set({ isActive: false })
    .where(eq(followupTemplates.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function listFunnelStages(
  db: DbClient,
  args: { tenantId: string; includeInactive?: boolean },
): Promise<FunnelStage[]> {
  const condition = args.includeInactive
    ? eq(funnelStages.tenantId, args.tenantId)
    : and(eq(funnelStages.tenantId, args.tenantId), eq(funnelStages.isActive, true));

  return db.select().from(funnelStages).where(condition).orderBy(asc(funnelStages.position));
}

export async function listLeadFollowupHistory(
  db: DbClient,
  args: { tenantId: string; subscriberId: string; limit?: number },
): Promise<LeadFollowupLog[]> {
  return db
    .select()
    .from(leadFollowupLog)
    .where(
      and(
        eq(leadFollowupLog.tenantId, args.tenantId),
        eq(leadFollowupLog.subscriberId, args.subscriberId),
      ),
    )
    .orderBy(desc(leadFollowupLog.sentAt))
    .limit(args.limit ?? 100);
}
