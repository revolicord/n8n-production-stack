import type { DbClient } from '@dm-api/db';
import { flowDefinitions } from '@dm-api/db';
import type { FlowDefinition } from '@dm-api/shared';
import { FlowDefinitionSchema } from '@dm-api/shared';
import { and, eq } from 'drizzle-orm';

export async function loadActiveFlows(
  db: DbClient,
  tenantId: string,
): Promise<Map<string, { version: number; def: FlowDefinition }>> {
  const rows = await db
    .select()
    .from(flowDefinitions)
    .where(and(eq(flowDefinitions.tenantId, tenantId), eq(flowDefinitions.active, true)));

  const map = new Map<string, { version: number; def: FlowDefinition }>();
  for (const row of rows) {
    const parsed = FlowDefinitionSchema.safeParse(row.definition);
    if (!parsed.success) continue;
    map.set(parsed.data.flow_id, { version: row.version, def: parsed.data });
  }
  return map;
}
