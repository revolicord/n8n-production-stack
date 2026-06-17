/**
 * replay.ts — Reproduce conversaciones históricas en dry-run
 *
 * Uso:
 *   tsx apps/agent/scripts/replay.ts --subscriber-id <uuid> [--limit 20]
 *   tsx apps/agent/scripts/replay.ts --tenant-id <uuid> [--limit 20]
 *
 * Para cada turn del subscriber/tenant:
 *   1. Reconstruye los mensajes desde messages_raw (direction='in')
 *   2. Ejecuta runGraph con dry_run=true, RNG determinista seeded con turn_id,
 *      clock congelado al started_at del turn
 *   3. Imprime un diff contra lo que realmente ocurrió (response_text + stage transitions)
 *
 * Uso típico: regresión de prompt tras ajuste de persona/esqueleto.
 *   tsx apps/agent/scripts/replay.ts --subscriber-id <id> | tee replay-out.txt
 */

import process from 'node:process';
import { createDb, messagesRaw, stageTransitions, turns } from '@dm-api/db';
import type { AgentResponse } from '@dm-api/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { pino } from 'pino';
import { getAgentConfig } from '../src/config.js';
import { makeDeps } from '../src/deps.js';
import { runGraph } from '../src/graph/build-graph.js';

// ─── CLI args ────────────────────────────────────────────────────────────────

function parseArgs(): { subscriberId?: string; tenantId?: string; limit: number } {
  const args = process.argv.slice(2);
  let subscriberId: string | undefined;
  let tenantId: string | undefined;
  let limit = 20;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--subscriber-id' && args[i + 1]) subscriberId = args[++i];
    else if (args[i] === '--tenant-id' && args[i + 1]) tenantId = args[++i];
    else if (args[i] === '--limit' && args[i + 1]) limit = Number(args[++i]);
  }

  if (!subscriberId && !tenantId) {
    console.error('Usage: replay.ts --subscriber-id <uuid> | --tenant-id <uuid> [--limit N]');
    process.exit(1);
  }

  return { subscriberId, tenantId, limit };
}

// ─── Seeded LCG RNG (determinista por turn_id) ───────────────────────────────

function seededRng(seed: string): () => number {
  let state = [...seed].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 0);
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  const config = getAgentConfig();
  const db = createDb(config.DATABASE_URL);
  const log = pino({ level: 'warn' });

  // Cargar turns del subscriber o tenant
  const conditions = opts.subscriberId
    ? eq(turns.subscriberId, opts.subscriberId)
    : eq(turns.tenantId, opts.tenantId as string);

  const targetTurns = await db
    .select()
    .from(turns)
    .where(and(conditions, eq(turns.status, 'completed')))
    .orderBy(asc(turns.startedAt))
    .limit(opts.limit);

  if (targetTurns.length === 0) {
    console.info('No completed turns found for the given filter.');
    process.exit(0);
  }

  console.info(`\nReplay de ${targetTurns.length} turnos\n${'─'.repeat(60)}`);

  let matched = 0;
  let diverged = 0;

  for (const turn of targetTurns) {
    // 1. Reconstruir mensajes desde messages_raw
    const rawMsgs = await db
      .select()
      .from(messagesRaw)
      .where(and(inArray(messagesRaw.id, turn.batchMessageIds), eq(messagesRaw.direction, 'in')))
      .orderBy(asc(messagesRaw.receivedAt));

    if (rawMsgs.length === 0) {
      console.info(`[${turn.id}] SKIP — sin mensajes en messages_raw`);
      continue;
    }

    const messages = rawMsgs.map((m) => {
      const p = (m.payload ?? {}) as Record<string, unknown>;
      return {
        id: m.id,
        external_message_id: m.externalMessageId,
        text: m.text,
        reply_type: (p.reply_type as string | null) ?? null,
        ts: m.receivedAt.getTime(),
        media_urls: (m.mediaUrls ?? []) as string[],
        content_class: (p.content_class as string) ?? (m.hasMedia ? 'image' : 'text'),
      };
    });

    // 2. Cargar transición real (si hubo)
    const realTransitions = await db
      .select({ fromStage: stageTransitions.fromStage, toStage: stageTransitions.toStage })
      .from(stageTransitions)
      .where(eq(stageTransitions.turnId, turn.id));

    // 3. Ejecutar en dry-run con RNG seeded y clock congelado
    const frozenClock = turn.startedAt.getTime();
    const deps = makeDeps({
      db,
      logger: log,
      clock: () => frozenClock,
      rng: seededRng(turn.id),
    });

    let res: AgentResponse | undefined;
    try {
      res = await runGraph(
        {
          schema_version: 'v1',
          turn_id: turn.id,
          tenant_id: turn.tenantId,
          subscriber_id: turn.subscriberId,
          conversation_id: turn.conversationId,
          trigger: {
            source: 'lead_message',
            channel: (turn.triggerChannel ?? 'instagram') as string,
          },
          messages,
          system_commands: [],
          dry_run: true,
          run_mode: 'replay',
        },
        deps,
      );
    } catch (err) {
      console.info(`[${turn.id}] ERROR: ${err instanceof Error ? err.message : String(err)}`);
      diverged++;
      continue;
    }

    if (!res) continue;

    // 4. Comparar
    const realStage = realTransitions[0]?.toStage ?? null;
    const changeStageCmd = res.commands.find((c) => c.type === 'ChangeStage');
    const shadowStage = changeStageCmd?.type === 'ChangeStage' ? changeStageCmd.to_stage : null;

    const shadowTexts = res.response_texts.join(' | ');
    const realText = turn.responseText ?? '(sin respuesta)';

    const stageMatch = realStage === shadowStage;
    const status = stageMatch ? 'MATCH' : 'DIVERGE';
    if (stageMatch) matched++;
    else diverged++;

    const ts = turn.startedAt.toISOString().slice(0, 16);
    console.info(`[${ts}] ${status} — turn ${turn.id.slice(0, 8)}`);

    if (!stageMatch) {
      console.info(`  stage  real=${realStage ?? '-'} shadow=${shadowStage ?? '-'}`);
    }
    if (res.response_texts.length > 0 && realText !== shadowTexts) {
      console.info(`  n8n:    ${realText.slice(0, 120)}`);
      console.info(`  shadow: ${shadowTexts.slice(0, 120)}`);
    }
  }

  console.info(`\n${'─'.repeat(60)}`);
  console.info(`Total: ${targetTurns.length} | Match: ${matched} | Diverge: ${diverged}`);
  const pct = targetTurns.length > 0 ? ((matched / targetTurns.length) * 100).toFixed(1) : '0';
  console.info(`Paridad de etapas: ${pct}%`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
