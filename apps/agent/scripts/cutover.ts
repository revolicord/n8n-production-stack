/**
 * cutover.ts — Fase 4 ADR-0024: inicialización de dialogue_states para leads vivos
 *
 * Uso:
 *   tsx apps/agent/scripts/cutover.ts --tenant-slug <slug>
 *   tsx apps/agent/scripts/cutover.ts --tenant-id <uuid>
 *   tsx apps/agent/scripts/cutover.ts --all           # todos los tenants activos
 *   tsx apps/agent/scripts/cutover.ts --dry-run --tenant-slug qc   # sin escribir
 *
 * Para cada conversación abierta sin dialogue_states existente:
 *   - Inserta estado inicial vacío (stack=[], slots={}, repair_context=null)
 *   - La operación es idempotente (INSERT ON CONFLICT DO NOTHING)
 *
 * El estado inicial vacío es suficiente: assembleContext carga el estado en cada turno
 * y, si no existe, arranca con el estado vacío de EMPTY_STATE. Este script solo garantiza
 * que la fila exista para que queries de ops y el dashboard puedan listarla.
 *
 * Pérdida aceptada (documentada en el plan): matices de texto del bot pre-cutover más
 * allá de response_text. El stack de flows y los slots empiezan desde cero con el motor nuevo.
 */

import process from 'node:process';
import { conversations, createDb, dialogueStates, tenants } from '@dm-api/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { pino } from 'pino';
import { getAgentConfig } from '../src/config.js';

// ─── CLI args ────────────────────────────────────────────────────────────────

interface Args {
  tenantSlug?: string;
  tenantId?: string;
  all: boolean;
  dryRun: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let tenantSlug: string | undefined;
  let tenantId: string | undefined;
  let all = false;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--tenant-slug' && args[i + 1]) tenantSlug = args[++i];
    else if (arg === '--tenant-id' && args[i + 1]) tenantId = args[++i];
    else if (arg === '--all') all = true;
    else if (arg === '--dry-run') dryRun = true;
  }

  if (!tenantSlug && !tenantId && !all) {
    console.error(
      'Usage: cutover.ts --tenant-slug <slug> | --tenant-id <uuid> | --all [--dry-run]',
    );
    process.exit(1);
  }

  return { tenantSlug, tenantId, all, dryRun };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  const config = getAgentConfig();
  const db = createDb(config.DATABASE_URL);
  const log = pino({ level: 'info' });

  if (opts.dryRun) {
    log.info('DRY RUN — no se escribirá nada en la base de datos');
  }

  // 1. Resolver tenant IDs
  const tenantRows = await db
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .where(
      opts.all
        ? eq(tenants.isActive, true)
        : opts.tenantId
          ? eq(tenants.id, opts.tenantId)
          : eq(tenants.slug, opts.tenantSlug as string),
    );

  if (tenantRows.length === 0) {
    log.error({ filter: opts }, 'Ningún tenant encontrado con el filtro dado');
    process.exit(1);
  }

  log.info({ tenants: tenantRows.map((t) => t.slug) }, 'Tenants a procesar');

  let totalOpen = 0;
  let totalAlreadyHad = 0;
  let totalCreated = 0;
  let totalErrors = 0;

  for (const tenant of tenantRows) {
    // 2. Buscar conversaciones abiertas sin dialogue_states
    const openConvs = await db
      .select({ id: conversations.id })
      .from(conversations)
      .leftJoin(dialogueStates, eq(conversations.id, dialogueStates.conversationId))
      .where(
        and(
          eq(conversations.tenantId, tenant.id),
          eq(conversations.status, 'open'),
          isNull(dialogueStates.conversationId),
        ),
      );

    // 3. También contar cuántas ya tienen estado (para el reporte)
    const allOpenConvs = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.tenantId, tenant.id), eq(conversations.status, 'open')));

    const alreadyHad = allOpenConvs.length - openConvs.length;

    log.info(
      {
        tenant: tenant.slug,
        open_total: allOpenConvs.length,
        already_have_state: alreadyHad,
        need_init: openConvs.length,
      },
      'Análisis de conversaciones',
    );

    totalOpen += allOpenConvs.length;
    totalAlreadyHad += alreadyHad;

    if (openConvs.length === 0) {
      log.info({ tenant: tenant.slug }, 'Nada que inicializar');
      continue;
    }

    if (opts.dryRun) {
      log.info(
        { tenant: tenant.slug, would_create: openConvs.length },
        '[DRY RUN] Se crearían estas filas en dialogue_states',
      );
      totalCreated += openConvs.length;
      continue;
    }

    // 4. Insertar estados iniciales vacíos en lotes de 100
    const BATCH = 100;
    for (let i = 0; i < openConvs.length; i += BATCH) {
      const batch = openConvs.slice(i, i + BATCH);
      try {
        await db
          .insert(dialogueStates)
          .values(
            batch.map((conv) => ({
              conversationId: conv.id,
              tenantId: tenant.id,
              stack: sql`'[]'::jsonb`,
              slots: sql`'{}'::jsonb`,
              repairContext: undefined,
              lastTurnId: undefined,
              updatedAt: sql`now()`,
            })),
          )
          .onConflictDoNothing();

        totalCreated += batch.length;
        log.info(
          { tenant: tenant.slug, batch_start: i, batch_size: batch.length },
          'Estados inicializados',
        );
      } catch (err) {
        log.error({ err, tenant: tenant.slug, batch_start: i }, 'Error al insertar batch');
        totalErrors += batch.length;
      }
    }
  }

  // ─── Resumen final ────────────────────────────────────────────────────────
  console.info(`\n${'─'.repeat(60)}`);
  console.info('Cutover ADR-0024 — Resumen');
  console.info('─'.repeat(60));
  console.info(`Tenants procesados : ${tenantRows.length}`);
  console.info(`Convs abiertas     : ${totalOpen}`);
  console.info(`Ya tenían estado   : ${totalAlreadyHad}`);
  console.info(`Creadas ahora      : ${totalCreated}${opts.dryRun ? ' (dry-run)' : ''}`);
  if (totalErrors > 0) console.info(`Errores            : ${totalErrors}`);
  console.info('─'.repeat(60));

  if (totalErrors > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
