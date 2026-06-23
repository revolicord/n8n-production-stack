import {
  type AgentResource,
  type DbClient,
  type NewAgentResource,
  agentResources,
} from '@dm-api/db';
import { and, asc, eq } from 'drizzle-orm';

export type { AgentResource };

export async function listAgentResources(
  db: DbClient,
  args: { tenantId: string; category?: string },
): Promise<AgentResource[]> {
  const conditions = [
    eq(agentResources.tenantId, args.tenantId),
    eq(agentResources.isActive, true),
  ];
  if (args.category) {
    conditions.push(eq(agentResources.category, args.category));
  }
  return db
    .select()
    .from(agentResources)
    .where(and(...conditions))
    .orderBy(asc(agentResources.sortOrder), asc(agentResources.createdAt));
}

export async function getAgentResourceById(
  db: DbClient,
  id: string,
): Promise<AgentResource | null> {
  const rows = await db.select().from(agentResources).where(eq(agentResources.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createAgentResource(
  db: DbClient,
  data: NewAgentResource,
): Promise<AgentResource> {
  const rows = await db.insert(agentResources).values(data).returning();
  const row = rows[0];
  if (!row) throw new Error('agent_resources insert returned no rows');
  return row;
}

export async function updateAgentResource(
  db: DbClient,
  id: string,
  patch: Partial<
    Pick<
      AgentResource,
      | 'displayName'
      | 'triggerHint'
      | 'textContent'
      | 'mediaUrl'
      | 'sortOrder'
      | 'category'
      | 'slug'
      | 'config'
    >
  >,
): Promise<AgentResource | null> {
  const rows = await db
    .update(agentResources)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(agentResources.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function deactivateAgentResource(
  db: DbClient,
  id: string,
): Promise<AgentResource | null> {
  const rows = await db
    .update(agentResources)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(agentResources.id, id))
    .returning();
  return rows[0] ?? null;
}
