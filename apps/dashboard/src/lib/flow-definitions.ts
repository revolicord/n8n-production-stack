import { db, flowDefinitions, stageFlows } from '@/lib/db';
import { and, asc, eq } from 'drizzle-orm';

export type FlowDefinitionRow = {
  id: string;
  flowId: string;
  version: number;
  definition: unknown;
};

export async function listFlowDefinitions(tenantId: string): Promise<FlowDefinitionRow[]> {
  return db
    .select({
      id: flowDefinitions.id,
      flowId: flowDefinitions.flowId,
      version: flowDefinitions.version,
      definition: flowDefinitions.definition,
    })
    .from(flowDefinitions)
    .where(and(eq(flowDefinitions.tenantId, tenantId), eq(flowDefinitions.active, true)))
    .orderBy(asc(flowDefinitions.flowId));
}

export type StageFlowOption = {
  slugId: string;
  humanName: string | null;
  mediaType: string | null;
};

export async function listStageFlowsForTenant(tenantId: string): Promise<StageFlowOption[]> {
  const rows = await db
    .select({
      slugId: stageFlows.slugId,
      humanName: stageFlows.humanName,
      mediaType: stageFlows.mediaType,
    })
    .from(stageFlows)
    .where(and(eq(stageFlows.tenantId, tenantId), eq(stageFlows.isActive, true)))
    .orderBy(asc(stageFlows.humanName));

  // Solo los que tienen slug_id sirven para send_content.
  return rows.filter((r): r is StageFlowOption & { slugId: string } => r.slugId !== null);
}
