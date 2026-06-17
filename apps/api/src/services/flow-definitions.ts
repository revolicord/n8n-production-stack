import {
  type DbClient,
  type FlowDefinition as FlowDefinitionRow,
  type StageFlow,
  flowDefinitions,
  stageFlows,
} from '@dm-api/db';
import type { FlowDefinition } from '@dm-api/shared';
import { and, asc, desc, eq } from 'drizzle-orm';

export async function listFlowDefinitions(
  db: DbClient,
  tenantId: string,
): Promise<FlowDefinitionRow[]> {
  return db
    .select()
    .from(flowDefinitions)
    .where(and(eq(flowDefinitions.tenantId, tenantId), eq(flowDefinitions.active, true)))
    .orderBy(asc(flowDefinitions.flowId));
}

export async function getFlowDefinitionById(
  db: DbClient,
  id: string,
): Promise<FlowDefinitionRow | null> {
  const rows = await db.select().from(flowDefinitions).where(eq(flowDefinitions.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Crea una nueva versión activa de un flow y desactiva la anterior en una
 * transacción, respetando el unique constraint `flow_definitions_one_active_unique`
 * (una sola fila active=true por tenant+flow_id). Sirve tanto para alta como
 * para edición: cada write engendra una versión nueva inmutable.
 */
export async function createFlowDefinition(
  db: DbClient,
  args: { tenantId: string; definition: FlowDefinition },
): Promise<FlowDefinitionRow> {
  const flowId = args.definition.flow_id;

  return db.transaction(async (tx) => {
    const [latest] = await tx
      .select({ version: flowDefinitions.version })
      .from(flowDefinitions)
      .where(and(eq(flowDefinitions.tenantId, args.tenantId), eq(flowDefinitions.flowId, flowId)))
      .orderBy(desc(flowDefinitions.version))
      .limit(1);

    const nextVersion = (latest?.version ?? 0) + 1;

    await tx
      .update(flowDefinitions)
      .set({ active: false })
      .where(
        and(
          eq(flowDefinitions.tenantId, args.tenantId),
          eq(flowDefinitions.flowId, flowId),
          eq(flowDefinitions.active, true),
        ),
      );

    const [row] = await tx
      .insert(flowDefinitions)
      .values({
        tenantId: args.tenantId,
        flowId,
        version: nextVersion,
        definition: args.definition,
        active: true,
      })
      .returning();

    if (!row) throw new Error('flow_definitions insert returned no row');
    return row;
  });
}

export async function deactivateFlowDefinition(
  db: DbClient,
  id: string,
): Promise<FlowDefinitionRow | null> {
  const rows = await db
    .update(flowDefinitions)
    .set({ active: false })
    .where(eq(flowDefinitions.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function listStageFlowsForTenant(
  db: DbClient,
  tenantId: string,
): Promise<StageFlow[]> {
  return db
    .select()
    .from(stageFlows)
    .where(and(eq(stageFlows.tenantId, tenantId), eq(stageFlows.isActive, true)))
    .orderBy(asc(stageFlows.humanName));
}

export type CreateStageFlowInput = {
  tenantId: string;
  stageId: string;
  flowNs: string;
  humanName: string;
  mediaType?: string | null;
  slugId?: string | null;
  contentDescription?: string | null;
  usageCondition?: string | null;
};

export async function createStageFlow(
  db: DbClient,
  input: CreateStageFlowInput,
): Promise<StageFlow> {
  const [row] = await db
    .insert(stageFlows)
    .values({
      tenantId: input.tenantId,
      stageId: input.stageId,
      flowNs: input.flowNs,
      humanName: input.humanName,
      mediaType: input.mediaType ?? null,
      slugId: input.slugId ?? null,
      contentDescription: input.contentDescription ?? null,
      usageCondition: input.usageCondition ?? null,
      weight: 1,
      isActive: true,
    })
    .returning();
  if (!row) throw new Error('stage_flows insert returned no row');
  return row;
}

export type StageFlowPatch = {
  humanName?: string;
  contentDescription?: string | null;
  usageCondition?: string | null;
  mediaType?: string | null;
  slugId?: string | null;
  isActive?: boolean;
};

export async function updateStageFlow(
  db: DbClient,
  id: string,
  patch: StageFlowPatch,
): Promise<StageFlow | null> {
  const rows = await db
    .update(stageFlows)
    .set({
      ...(patch.humanName !== undefined && { humanName: patch.humanName }),
      ...(patch.contentDescription !== undefined && {
        contentDescription: patch.contentDescription,
      }),
      ...(patch.usageCondition !== undefined && { usageCondition: patch.usageCondition }),
      ...(patch.mediaType !== undefined && { mediaType: patch.mediaType }),
      ...(patch.slugId !== undefined && { slugId: patch.slugId }),
      ...(patch.isActive !== undefined && { isActive: patch.isActive }),
    })
    .where(eq(stageFlows.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function deleteStageFlow(db: DbClient, id: string): Promise<boolean> {
  const rows = await db
    .delete(stageFlows)
    .where(eq(stageFlows.id, id))
    .returning({ id: stageFlows.id });
  return rows.length > 0;
}
