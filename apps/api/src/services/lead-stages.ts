import { leadStages, stageTransitions } from '@dm-api/db';
import type { DbClient } from '@dm-api/db';
import { and, eq, sql } from 'drizzle-orm';

export async function getLeadStage(
  db: DbClient,
  args: { tenantId: string; subscriberId: string },
): Promise<string> {
  const rows = await db
    .select({ currentStage: leadStages.currentStage })
    .from(leadStages)
    .where(
      and(eq(leadStages.tenantId, args.tenantId), eq(leadStages.subscriberId, args.subscriberId)),
    )
    .limit(1);
  return rows[0]?.currentStage ?? 'nuevo';
}

export async function upsertLeadStage(
  db: DbClient,
  args: { tenantId: string; subscriberId: string; stage: string },
): Promise<void> {
  await db
    .insert(leadStages)
    .values({
      tenantId: args.tenantId,
      subscriberId: args.subscriberId,
      currentStage: args.stage,
      updatedAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: [leadStages.tenantId, leadStages.subscriberId],
      set: { currentStage: args.stage, updatedAt: sql`now()` },
    });
}

export async function createStageTransition(
  db: DbClient,
  args: {
    tenantId: string;
    subscriberId: string;
    turnId?: string | null;
    fromStage: string;
    toStage: string;
    reason?: string | null;
    agentEvidence?: string | null;
  },
): Promise<void> {
  await db.insert(stageTransitions).values({
    tenantId: args.tenantId,
    subscriberId: args.subscriberId,
    turnId: args.turnId ?? null,
    fromStage: args.fromStage,
    toStage: args.toStage,
    reason: args.reason ?? null,
    agentEvidence: args.agentEvidence ?? null,
  });
}
