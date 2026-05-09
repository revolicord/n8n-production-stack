import { sql as drizzleSql, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { tenants } from './schema.js';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`${name} is required`);
    process.exit(1);
  }
  return v;
}

const DATABASE_URL = requireEnv('DATABASE_URL');
const TENANT_SLUG = process.env.SEED_TENANT_SLUG ?? 'dev';
const TENANT_NAME = process.env.SEED_TENANT_NAME ?? 'Dev tenant';
const N8N_WORKFLOW_URL = process.env.SEED_N8N_WORKFLOW_URL ?? '';

async function main() {
  const client = postgres(DATABASE_URL, { max: 1, prepare: false });
  const db = drizzle(client);

  const config: Record<string, unknown> = {
    debounce_ms: 8000,
    max_wait_ms: 30000,
    rate_per_minute: 20,
    buffer_hard_limit: 20,
    model: 'gpt-4o-mini',
  };
  if (N8N_WORKFLOW_URL) config.n8n_workflow_url = N8N_WORKFLOW_URL;

  const existing = await db.select().from(tenants).where(eq(tenants.slug, TENANT_SLUG)).limit(1);
  if (existing[0]) {
    console.log(`[seed] tenant '${TENANT_SLUG}' already exists (id=${existing[0].id})`);
    if (N8N_WORKFLOW_URL) {
      await db
        .update(tenants)
        .set({ config: drizzleSql`${JSON.stringify(config)}::jsonb`, updatedAt: drizzleSql`now()` })
        .where(eq(tenants.id, existing[0].id));
      console.log('[seed] config updated with provided n8n_workflow_url');
    }
    await client.end();
    return;
  }

  const [created] = await db
    .insert(tenants)
    .values({ slug: TENANT_SLUG, name: TENANT_NAME, config })
    .returning();

  console.log(`[seed] tenant created: id=${created?.id} slug=${TENANT_SLUG}`);
  await client.end();
}

main().catch((err) => {
  console.error('[seed] failed', err);
  process.exit(1);
});
