import { StageEditor } from '@/components/settings/StageEditor';
import { getStageBySlug, listFollowups } from '@/lib/followups';
import { getActiveTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

export default async function FaseCPage() {
  const tenant = await getActiveTenant();
  const stage = await getStageBySlug(tenant.id, 'C');
  if (!stage) {
    return <p className="p-6 text-qc-textSubtle text-sm">No existe la etapa C para este tenant.</p>;
  }
  const templates = await listFollowups(stage.id);
  return <StageEditor tenantId={tenant.id} title="Fase C" stage={stage} templates={templates} />;
}
