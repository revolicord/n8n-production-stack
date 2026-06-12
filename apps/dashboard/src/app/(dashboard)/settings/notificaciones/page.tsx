import { NotificationsEditor } from '@/components/settings/NotificationsEditor';
import { db, tenants } from '@/lib/db';
import { getActiveTenant } from '@/lib/tenant';
import { TenantConfigSchema } from '@dm-api/shared';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export default async function NotificacionesPage() {
  const tenant = await getActiveTenant();
  const [row] = await db
    .select({ config: tenants.config })
    .from(tenants)
    .where(eq(tenants.id, tenant.id))
    .limit(1);

  const parsed = TenantConfigSchema.safeParse(row?.config);
  const config = parsed.success ? parsed.data : {};

  return (
    <NotificationsEditor
      tenantId={tenant.id}
      keywords={config.notification_keywords ?? []}
      mediaPolicy={config.media_policy ?? {}}
    />
  );
}
