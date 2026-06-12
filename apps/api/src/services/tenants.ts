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

/**
 * Merge superficial de un patch sobre `tenant.config` (JSONB) y persistencia.
 * No reemplaza: preserva las claves existentes que el patch no toca. Devuelve
 * el tenant actualizado, o null si no existe.
 */
export async function updateTenantConfig(
  db: DbClient,
  args: { tenantId: string; patch: Partial<TenantConfig> },
): Promise<Tenant | null> {
  const current = await getTenantById(db, args.tenantId);
  if (!current) return null;
  const merged = { ...parseTenantConfig(current.config), ...args.patch };
  const rows = await db
    .update(tenants)
    .set({ config: merged })
    .where(eq(tenants.id, args.tenantId))
    .returning();
  return rows[0] ?? null;
}
