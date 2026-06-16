/**
 * prune-traces.ts — Limpieza de agent_turn_traces por retención (ADR-0025).
 *
 * Uso:
 *   tsx apps/agent/scripts/prune-traces.ts [--days 30]
 *
 * Borra todas las trazas más viejas que N días (default 30). Pensado para correr
 * periódicamente (cron / make prune-traces) y acotar volumen y exposición de PII.
 */

import process from 'node:process';
import { createDb } from '@dm-api/db';
import { sql } from 'drizzle-orm';
import { getAgentConfig } from '../src/config.js';

function parseDays(): number {
  const args = process.argv.slice(2);
  const i = args.indexOf('--days');
  if (i >= 0 && args[i + 1]) {
    const n = Number(args[i + 1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 30;
}

async function main() {
  const days = parseDays();
  const config = getAgentConfig();
  const db = createDb(config.DATABASE_URL);

  const result = await db.execute(
    sql`DELETE FROM api.agent_turn_traces WHERE created_at < now() - (${days} || ' days')::interval`,
  );
  // postgres-js devuelve el count en .count; drizzle lo expone según driver.
  const count = (result as unknown as { count?: number }).count ?? 0;
  // biome-ignore lint/suspicious/noConsoleLog: CLI script, intentional output
  console.log(`[prune-traces] borradas ${count} trazas con más de ${days} días`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[prune-traces] failed', err);
  process.exit(1);
});
