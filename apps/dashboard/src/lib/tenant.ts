import { db, tenants } from '@/lib/db';
import { eq } from 'drizzle-orm';

export type Tenant = { id: string; name: string; slug: string };

export async function getActiveTenant(): Promise<Tenant> {
  const [row] = await db
    .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.isActive, true))
    .limit(1);

  if (!row) throw new Error('No active tenant found');
  return row;
}
