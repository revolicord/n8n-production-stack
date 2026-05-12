import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

async function main() {
  const client = postgres(DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });

  // biome-ignore lint/suspicious/noConsoleLog: CLI script, intentional output
  console.log(`[migrate] applying migrations from ${migrationsFolder}`);

  // Ensure schema and extension exist using DO blocks to avoid ErrorResponse on duplicates
  await client.unsafe(
    'DO $$ BEGIN CREATE SCHEMA api; EXCEPTION WHEN duplicate_schema THEN NULL; END $$',
  );
  await client.unsafe(
    'DO $$ BEGIN CREATE EXTENSION pgcrypto; EXCEPTION WHEN duplicate_object THEN NULL; END $$',
  );

  // Ensure migrations tracking table exists
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS api.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash TEXT NOT NULL,
      created_at BIGINT
    )
  `);

  // Read applied migrations
  const applied = await client<{ hash: string }[]>`
    SELECT hash FROM api.__drizzle_migrations ORDER BY created_at ASC
  `;
  const appliedHashes = new Set(applied.map((r) => r.hash));

  // Read journal
  const journalPath = join(migrationsFolder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf-8')) as {
    entries: JournalEntry[];
  };

  let applied_count = 0;
  for (const entry of journal.entries.sort((a, b) => a.idx - b.idx)) {
    const sqlPath = join(migrationsFolder, `${entry.tag}.sql`);
    const sql = readFileSync(sqlPath, 'utf-8');
    const hash = createHash('sha256').update(sql).digest('hex');

    if (appliedHashes.has(hash)) {
      // biome-ignore lint/suspicious/noConsoleLog: CLI script, intentional output
      console.log(`[migrate] skip ${entry.tag} (already applied)`);
      continue;
    }

    // biome-ignore lint/suspicious/noConsoleLog: CLI script, intentional output
    console.log(`[migrate] apply ${entry.tag}`);

    // Split on drizzle breakpoint marker and run each statement
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);

    for (const stmt of statements) {
      await client.unsafe(stmt);
    }

    await client`
      INSERT INTO api.__drizzle_migrations (hash, created_at)
      VALUES (${hash}, ${entry.when})
    `;

    applied_count++;
  }

  // biome-ignore lint/suspicious/noConsoleLog: CLI script, intentional output
  console.log(`[migrate] done — ${applied_count} migration(s) applied`);

  await client.end();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[migrate] failed', err);
    process.exit(1);
  });
