import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`${name} is required`);
    process.exit(1);
  }
  return v;
}

const DATABASE_URL = requireEnv('DATABASE_URL');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '..', 'drizzle');

async function main() {
  const client = postgres(DATABASE_URL, { max: 1, prepare: false });
  const db = drizzle(client);

  // biome-ignore lint/suspicious/noConsoleLog: CLI script, intentional output
  console.log(`[migrate] applying migrations from ${migrationsFolder}`);

  // Ensure schema 'api' exists before applying migrations
  await client.unsafe('CREATE SCHEMA IF NOT EXISTS api');
  await client.unsafe('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  await migrate(db, { migrationsFolder, migrationsSchema: 'api' });

  // biome-ignore lint/suspicious/noConsoleLog: CLI script, intentional output
  console.log('[migrate] done');

  await client.end();
}

main().catch((err) => {
  console.error('[migrate] failed', err);
  process.exit(1);
});
