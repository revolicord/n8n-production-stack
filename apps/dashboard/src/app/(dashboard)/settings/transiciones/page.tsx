import { TransitionsEditor } from '@/components/settings/TransitionsEditor';
import { listActiveStageOptions, listTransitionRules } from '@/lib/stage-transitions';
import { getActiveTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

export default async function TransicionesPage() {
  const tenant = await getActiveTenant();
  const [transitions, stages] = await Promise.all([
    listTransitionRules(tenant.id),
    listActiveStageOptions(tenant.id),
  ]);

  return <TransitionsEditor tenantId={tenant.id} transitions={transitions} stages={stages} />;
}
