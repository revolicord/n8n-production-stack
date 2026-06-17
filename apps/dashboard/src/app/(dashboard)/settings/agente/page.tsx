import { AgenteEditor } from '@/components/settings/AgenteEditor';
import { db, tenants } from '@/lib/db';
import { getActiveTenant } from '@/lib/tenant';
import { TenantConfigSchema } from '@dm-api/shared';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export default async function AgentePage() {
  const tenant = await getActiveTenant();
  const [row] = await db
    .select({ config: tenants.config })
    .from(tenants)
    .where(eq(tenants.id, tenant.id))
    .limit(1);

  const parsed = TenantConfigSchema.safeParse(row?.config);
  const config = parsed.success ? parsed.data : {};

  return (
    <AgenteEditor
      tenantId={tenant.id}
      personaPrompt={config.persona_prompt ?? ''}
      calendlyUrl={config.calendly_url ?? ''}
      disqualificationReasons={config.disqualification_reasons ?? []}
    />
  );
}
