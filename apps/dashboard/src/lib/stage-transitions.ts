import { db, funnelStages, stageTransitionsMap } from '@/lib/db';
import { and, asc, eq } from 'drizzle-orm';

export type TransitionRuleRow = {
  id: string;
  fromStageSlug: string;
  toStageSlug: string;
  whenToUse: string;
  isActive: boolean;
};

export async function listTransitionRules(tenantId: string): Promise<TransitionRuleRow[]> {
  return db
    .select({
      id: stageTransitionsMap.id,
      fromStageSlug: stageTransitionsMap.fromStageSlug,
      toStageSlug: stageTransitionsMap.toStageSlug,
      whenToUse: stageTransitionsMap.whenToUse,
      isActive: stageTransitionsMap.isActive,
    })
    .from(stageTransitionsMap)
    .where(eq(stageTransitionsMap.tenantId, tenantId))
    .orderBy(asc(stageTransitionsMap.fromStageSlug), asc(stageTransitionsMap.toStageSlug));
}

export type StageOption = { slug: string; displayName: string };

export async function listActiveStageOptions(tenantId: string): Promise<StageOption[]> {
  return db
    .select({ slug: funnelStages.slug, displayName: funnelStages.displayName })
    .from(funnelStages)
    .where(and(eq(funnelStages.tenantId, tenantId), eq(funnelStages.isActive, true)))
    .orderBy(asc(funnelStages.position));
}
