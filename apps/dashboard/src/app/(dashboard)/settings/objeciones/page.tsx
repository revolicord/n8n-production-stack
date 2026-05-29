import { ResourcesEditor } from '@/components/settings/ResourcesEditor';
import { listResources } from '@/lib/resources';
import { getActiveTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

export default async function ObjecionesPage() {
  const tenant = await getActiveTenant();
  const resources = await listResources(tenant.id, 'objecion');
  return (
    <ResourcesEditor
      tenantId={tenant.id}
      category="objecion"
      title="Objeciones"
      resources={resources}
    />
  );
}
