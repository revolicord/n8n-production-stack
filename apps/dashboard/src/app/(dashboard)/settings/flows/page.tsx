import { type FlowRow, FlowsEditor, type StageOption } from '@/components/settings/FlowsEditor';
import { db, funnelStages, stageFlows } from '@/lib/db';
import { getActiveTenant } from '@/lib/tenant';
import { asc, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export default async function FlowsPage() {
  const tenant = await getActiveTenant();

  const [stagesRows, flowsRows] = await Promise.all([
    db
      .select({
        id: funnelStages.id,
        displayName: funnelStages.displayName,
        slug: funnelStages.slug,
        position: funnelStages.position,
      })
      .from(funnelStages)
      .where(eq(funnelStages.tenantId, tenant.id))
      .orderBy(asc(funnelStages.position)),

    db
      .select({
        id: stageFlows.id,
        humanName: stageFlows.humanName,
        flowNs: stageFlows.flowNs,
        contentDescription: stageFlows.contentDescription,
        usageCondition: stageFlows.usageCondition,
        mediaType: stageFlows.mediaType,
        slugId: stageFlows.slugId,
        isActive: stageFlows.isActive,
        stageId: stageFlows.stageId,
        pendingNs: stageFlows.pendingNs,
        syncedAt: stageFlows.syncedAt,
      })
      .from(stageFlows)
      .where(eq(stageFlows.tenantId, tenant.id))
      .orderBy(asc(stageFlows.humanName)),
  ]);

  const stageMap = new Map(stagesRows.map((s) => [s.id, s]));

  const flows: FlowRow[] = flowsRows.map((f) => {
    const stage = f.stageId ? (stageMap.get(f.stageId) ?? null) : null;
    return {
      ...f,
      stageDisplayName: stage?.displayName ?? null,
      stageSlug: stage?.slug ?? null,
      stagePosition: stage?.position ?? null,
    };
  });

  flows.sort((a, b) => {
    const pa = a.stagePosition ?? 999;
    const pb = b.stagePosition ?? 999;
    if (pa !== pb) return pa - pb;
    return (a.humanName ?? '').localeCompare(b.humanName ?? '');
  });

  const stages: StageOption[] = stagesRows;

  return <FlowsEditor tenantId={tenant.id} flows={flows} stages={stages} />;
}
