import { agentResources, db } from '@/lib/db';
import { and, asc, eq } from 'drizzle-orm';

export type ResourceCategory = 'general' | 'cierre' | 'objecion';

export type AgentResourceRow = {
  id: string;
  category: string;
  slug: string;
  displayName: string;
  triggerHint: string | null;
  textContent: string | null;
  mediaUrl: string | null;
  sortOrder: number;
  config: unknown | null;
};

// Lectura directa con Drizzle desde RSC. Solo recursos activos, ordenados.
export async function listResources(
  tenantId: string,
  category: ResourceCategory,
): Promise<AgentResourceRow[]> {
  return db
    .select({
      id: agentResources.id,
      category: agentResources.category,
      slug: agentResources.slug,
      displayName: agentResources.displayName,
      triggerHint: agentResources.triggerHint,
      textContent: agentResources.textContent,
      mediaUrl: agentResources.mediaUrl,
      sortOrder: agentResources.sortOrder,
      config: agentResources.config,
    })
    .from(agentResources)
    .where(
      and(
        eq(agentResources.tenantId, tenantId),
        eq(agentResources.category, category),
        eq(agentResources.isActive, true),
      ),
    )
    .orderBy(asc(agentResources.sortOrder), asc(agentResources.createdAt));
}
