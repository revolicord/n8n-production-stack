import { ResourcesEditor } from '@/components/settings/ResourcesEditor';
import { listResources } from '@/lib/resources';
import { getActiveTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

export default async function CierresPage() {
  const tenant = await getActiveTenant();
  const resources = await listResources(tenant.id, 'cierre');
  return (
    <ResourcesEditor tenantId={tenant.id} category="cierre" title="Cierres" resources={resources} />
  );
}
