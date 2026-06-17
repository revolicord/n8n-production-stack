import { FunnelEditor, type StageRow } from '@/components/settings/FunnelEditor';
import { db, funnelStages } from '@/lib/db';
import { getActiveTenant } from '@/lib/tenant';
import { asc, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export default async function FunnelPage() {
  const tenant = await getActiveTenant();
  const rows = await db
    .select({
      id: funnelStages.id,
      slug: funnelStages.slug,
      displayName: funnelStages.displayName,
      description: funnelStages.description,
      goal: funnelStages.goal,
      position: funnelStages.position,
      maxFollowups: funnelStages.maxFollowups,
      isTerminal: funnelStages.isTerminal,
      isActive: funnelStages.isActive,
    })
    .from(funnelStages)
    .where(eq(funnelStages.tenantId, tenant.id))
    .orderBy(asc(funnelStages.position));

  const stages: StageRow[] = rows.map((r) => ({
    ...r,
    isActive: r.isActive ?? true,
  }));

  return <FunnelEditor tenantId={tenant.id} stages={stages} />;
}
