import { db, funnelStages } from '@/lib/db';
import { and, asc, eq } from 'drizzle-orm';

export type Stage = {
  id: string;
  slug: string;
  displayName: string;
  position: number;
};

export async function getStagesForTenant(tenantId: string): Promise<Stage[]> {
  return db
    .select({
      id: funnelStages.id,
      slug: funnelStages.slug,
      displayName: funnelStages.displayName,
      position: funnelStages.position,
    })
    .from(funnelStages)
    .where(and(eq(funnelStages.tenantId, tenantId), eq(funnelStages.isActive, true)))
    .orderBy(asc(funnelStages.position));
}
