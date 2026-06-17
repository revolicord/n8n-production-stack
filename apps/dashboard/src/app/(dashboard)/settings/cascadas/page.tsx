import { CascadesEditor } from '@/components/settings/CascadesEditor';
import { listFlowDefinitions, listStageFlowsForTenant } from '@/lib/flow-definitions';
import { listActiveStageOptions } from '@/lib/stage-transitions';
import { getActiveTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

export default async function CascadasPage() {
  const tenant = await getActiveTenant();
  const [flows, stages, stageFlows] = await Promise.all([
    listFlowDefinitions(tenant.id),
    listActiveStageOptions(tenant.id),
    listStageFlowsForTenant(tenant.id),
  ]);

  return (
    <CascadesEditor tenantId={tenant.id} flows={flows} stages={stages} stageFlows={stageFlows} />
  );
}
