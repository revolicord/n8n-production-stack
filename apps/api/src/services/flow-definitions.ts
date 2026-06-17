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
