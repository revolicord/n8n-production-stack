import type {
  DbClient,
  FunnelStage,
  LeadContentSent,
  Notification,
  StageFlow,
  StageTransitionsMap,
  Subscriber,
  Tenant,
  Turn,
} from '@dm-api/db';
import {
  funnelStages,
  leadContentSent,
  leadStages,
  notifications,
  stageFlows,
  stageTransitionsMap,
  subscribers,
  tenants,
  turns,
} from '@dm-api/db';
import { and, desc, eq, gte } from 'drizzle-orm';

export async function loadTenant(db: DbClient, tenantId: string): Promise<Tenant | null> {
  const rows = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return rows[0] ?? null;
}

export async function loadSubscriber(
  db: DbClient,
  args: { tenantId: string; subscriberId: string },
): Promise<Subscriber | null> {
  const rows = await db
    .select()
    .from(subscribers)
    .where(and(eq(subscribers.tenantId, args.tenantId), eq(subscribers.id, args.subscriberId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function loadCurrentStage(
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
  return rows[0]?.currentStage ?? 'A';
}

export async function loadFunnelStages(db: DbClient, tenantId: string): Promise<FunnelStage[]> {
  return db
    .select()
    .from(funnelStages)
    .where(and(eq(funnelStages.tenantId, tenantId), eq(funnelStages.isActive, true)));
}

export async function loadTransitions(
  db: DbClient,
  tenantId: string,
): Promise<StageTransitionsMap[]> {
  return db
    .select()
    .from(stageTransitionsMap)
    .where(and(eq(stageTransitionsMap.tenantId, tenantId), eq(stageTransitionsMap.isActive, true)));
}

export async function loadStageFlowsByStage(
  db: DbClient,
  tenantId: string,
): Promise<Map<string, StageFlow[]>> {
  const stages = await loadFunnelStages(db, tenantId);
  const map = new Map<string, StageFlow[]>();

  for (const stage of stages) {
    const flows = await db
      .select()
      .from(stageFlows)
      .where(and(eq(stageFlows.tenantId, tenantId), eq(stageFlows.stageId, stage.id)));
    map.set(stage.slug, flows);
  }

  return map;
}

export async function loadNotifications(
  db: DbClient,
  args: { tenantId: string; subscriberId: string; limit?: number },
): Promise<Notification[]> {
  return db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.tenantId, args.tenantId),
        eq(notifications.subscriberId, args.subscriberId),
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(args.limit ?? 10);
}

export async function loadLeadContentSent(
  db: DbClient,
  args: { tenantId: string; subscriberId: string; conversationId: string },
): Promise<LeadContentSent[]> {
  return db
    .select()
    .from(leadContentSent)
    .where(
      and(
        eq(leadContentSent.tenantId, args.tenantId),
        eq(leadContentSent.subscriberId, args.subscriberId),
        eq(leadContentSent.conversationId, args.conversationId),
      ),
    )
    .orderBy(desc(leadContentSent.sentAt));
}

export async function loadRecentTurns(
  db: DbClient,
  args: { tenantId: string; subscriberId: string; limit: number },
): Promise<Turn[]> {
  return db
    .select()
    .from(turns)
    .where(
      and(
        eq(turns.tenantId, args.tenantId),
        eq(turns.subscriberId, args.subscriberId),
        gte(turns.status, 'completed'),
      ),
    )
    .orderBy(desc(turns.startedAt))
    .limit(args.limit);
}
