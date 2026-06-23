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
  agentResources,
  funnelStages,
  leadContentSent,
  leadStages,
  notifications,
  stageFlows,
  stageTransitions,
  stageTransitionsMap,
  subscribers,
  tenants,
  turns,
} from '@dm-api/db';
import { and, desc, eq, gt, gte, sql } from 'drizzle-orm';

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

/**
 * Cuenta los turnos COMPLETADOS del lead desde que entró a su etapa actual. Es la
 * señal del circuit breaker / detector de atasco: si el lead lleva muchos turnos en
 * la misma etapa SIN avanzar, está atascado (la "cola caótica" que sangra tokens).
 *
 * "Entró a la etapa actual" = el último `stage_transitions.created_at` del lead (log
 * inmutable de avances). Si nunca cambió de etapa, se cuentan todos sus turnos. El
 * turno en curso está `pending`, así que no entra (solo cuenta `completed`).
 */
export async function loadTurnsInCurrentStage(
  db: DbClient,
  args: { tenantId: string; subscriberId: string },
): Promise<number> {
  const lastTx = await db
    .select({ createdAt: stageTransitions.createdAt })
    .from(stageTransitions)
    .where(
      and(
        eq(stageTransitions.tenantId, args.tenantId),
        eq(stageTransitions.subscriberId, args.subscriberId),
      ),
    )
    .orderBy(desc(stageTransitions.createdAt))
    .limit(1);

  const since = lastTx[0]?.createdAt;
  const conds = [
    eq(turns.tenantId, args.tenantId),
    eq(turns.subscriberId, args.subscriberId),
    eq(turns.status, 'completed'),
  ];
  if (since) conds.push(gt(turns.startedAt, since));

  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(turns)
    .where(and(...conds));

  return rows[0]?.n ?? 0;
}

/**
 * Carga los recursos de objeción activos del tenant (category='objecion').
 * Usados por el detector determinista y por el executor para obtener la respuesta.
 */
export async function loadObjectionResources(
  db: DbClient,
  tenantId: string,
): Promise<
  Array<{
    slug: string;
    displayName: string;
    triggerHint?: string | null;
    textContent?: string | null;
    mediaUrl?: string | null;
    config?: unknown;
  }>
> {
  return db
    .select({
      slug: agentResources.slug,
      displayName: agentResources.displayName,
      triggerHint: agentResources.triggerHint,
      textContent: agentResources.textContent,
      mediaUrl: agentResources.mediaUrl,
      config: agentResources.config,
    })
    .from(agentResources)
    .where(
      and(
        eq(agentResources.tenantId, tenantId),
        eq(agentResources.category, 'objecion'),
        eq(agentResources.isActive, true),
      ),
    );
}
