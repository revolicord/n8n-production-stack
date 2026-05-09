import { type Tenant, tenants } from '@dm-api/db';
import type { DbClient } from '@dm-api/db';
import { type TenantConfig, TenantConfigSchema } from '@dm-api/shared';
import { eq } from 'drizzle-orm';

export async function getTenantBySlug(db: DbClient, slug: string): Promise<Tenant | null> {
  const rows = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export async function getTenantById(db: DbClient, id: string): Promise<Tenant | null> {
  const rows = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  return rows[0] ?? null;
}

export function parseTenantConfig(raw: unknown): TenantConfig {
  const result = TenantConfigSchema.safeParse(raw);
  return result.success ? result.data : {};
}
