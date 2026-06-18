import { FollowupsEditor } from '@/components/settings/FollowupsEditor';
import { db, tenants } from '@/lib/db';
import { getActiveTenant } from '@/lib/tenant';
import { TenantConfigSchema } from '@dm-api/shared';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export default async function FollowUpsPage() {
  const tenant = await getActiveTenant();
  const [row] = await db
    .select({ config: tenants.config })
    .from(tenants)
    .where(eq(tenants.id, tenant.id))
    .limit(1);

  const parsed = TenantConfigSchema.safeParse(row?.config);
  const config = parsed.success ? parsed.data : {};

  return (
    <FollowupsEditor
      tenantId={tenant.id}
      followupsEnabled={config.followups_enabled ?? true}
      resetOnReply={config.followup_reset_on_reply ?? true}
      window={config.followup_window ?? null}
    />
  );
}
