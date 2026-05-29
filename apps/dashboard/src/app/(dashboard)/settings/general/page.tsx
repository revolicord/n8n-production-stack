import { ResourcesEditor } from '@/components/settings/ResourcesEditor';
import { listResources } from '@/lib/resources';
import { getActiveTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

export default async function GeneralPage() {
  const tenant = await getActiveTenant();
  const resources = await listResources(tenant.id, 'general');
  return (
    <ResourcesEditor
      tenantId={tenant.id}
      category="general"
      title="Recursos generales"
      resources={resources}
    />
  );
}
