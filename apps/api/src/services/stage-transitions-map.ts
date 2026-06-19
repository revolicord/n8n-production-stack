import { type DbClient, type StageTransitionsMap, stageTransitionsMap } from '@dm-api/db';
import { and, asc, eq } from 'drizzle-orm';

export async function listStageTransitions(
  db: DbClient,
  args: { tenantId: string; includeInactive?: boolean },
): Promise<StageTransitionsMap[]> {
  const condition = args.includeInactive
    ? eq(stageTransitionsMap.tenantId, args.tenantId)
    : and(eq(stageTransitionsMap.tenantId, args.tenantId), eq(stageTransitionsMap.isActive, true));

  return db
    .select()
    .from(stageTransitionsMap)
    .where(condition)
    .orderBy(asc(stageTransitionsMap.fromStageSlug), asc(stageTransitionsMap.toStageSlug));
}

export async function getStageTransitionById(
  db: DbClient,
  id: string,
): Promise<StageTransitionsMap | null> {
  const rows = await db
    .select()
    .from(stageTransitionsMap)
    .where(eq(stageTransitionsMap.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function createStageTransition(
  db: DbClient,
  args: {
    tenantId: string;
    fromStageSlug: string;
    toStageSlug: string;
    whenToUse: string;
    trigger?: string | null;
  },
): Promise<StageTransitionsMap> {
  const [row] = await db
    .insert(stageTransitionsMap)
    .values({
      tenantId: args.tenantId,
      fromStageSlug: args.fromStageSlug,
      toStageSlug: args.toStageSlug,
      whenToUse: args.whenToUse,
      trigger: args.trigger ?? null,
    })
    .returning();

  if (!row) throw new Error('stage_transitions_map insert returned no row');
  return row;
}

export async function updateStageTransition(
  db: DbClient,
  id: string,
  patch: Partial<{ whenToUse: string; isActive: boolean; trigger: string | null }>,
): Promise<StageTransitionsMap | null> {
  const rows = await db
    .update(stageTransitionsMap)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(stageTransitionsMap.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function deactivateStageTransition(
  db: DbClient,
  id: string,
): Promise<StageTransitionsMap | null> {
  const rows = await db
    .update(stageTransitionsMap)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(stageTransitionsMap.id, id))
    .returning();
  return rows[0] ?? null;
}
