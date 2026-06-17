/**
 * seed-agent-config.ts — importa la configuración del MOTOR (ADR-0024/0025) de un
 * tenant desde archivos versionados en el repo: los flows declarativos
 * (`packages/db/src/seeds/flows-<slug>.json`), la persona del agente
 * (`packages/db/src/seeds/persona-<slug>.md`) y claves de `tenants.config`
 * version-controladas (`packages/db/src/seeds/config-<slug>.json`, opcional;
 * p. ej. `text_policy_by_stage` para la regla "camino feliz sin texto del LLM").
 *
 * Uso:
 *   tsx apps/agent/scripts/seed-agent-config.ts --tenant-slug qc
 *   tsx apps/agent/scripts/seed-agent-config.ts --tenant-slug qc --dry-run
 *   tsx apps/agent/scripts/seed-agent-config.ts --tenant-slug qc --no-persona
 *   tsx apps/agent/scripts/seed-agent-config.ts --tenant-slug qc --flows /ruta/flows.json
 *
 * Idempotente:
 *   - Flows: si ya existe una versión activa con definición idéntica, se omite.
 *     Si difiere (o no existe), crea una versión nueva activa y desactiva la anterior,
 *     respetando el unique constraint `flow_definitions_one_active_unique`.
 *   - Persona: hace merge de `persona_prompt` en `tenants.config` sin tocar otras claves.
 *   - Config: hace merge superficial de `config-<slug>.json` en `tenants.config`
 *     (validado contra TenantConfigSchema). El archivo es opcional. Flags: --config
 *     <ruta>, --no-config.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createDb, flowDefinitions, tenants } from '@dm-api/db';
import { type FlowDefinition, FlowDefinitionSchema, TenantConfigSchema } from '@dm-api/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import { pino } from 'pino';

// ─── Paths ─────────────────────────────────────────────────────────────────
// El compilado vive en apps/agent/dist/scripts/seed-agent-config.js → la raíz del
// repo (o /app en el contenedor) está 4 niveles arriba. Los seeds se copian a la
// imagen de runtime (ver apps/api/Dockerfile).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const SEEDS_DIR = resolve(REPO_ROOT, 'packages/db/src/seeds');

// ─── CLI args ────────────────────────────────────────────────────────────────
interface Args {
  tenantSlug: string;
  flowsPath: string | null;
  personaPath: string | null;
  configPath: string | null;
  importFlows: boolean;
  importPersona: boolean;
  importConfig: boolean;
  dryRun: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let tenantSlug: string | undefined;
  let flowsPath: string | null = null;
  let personaPath: string | null = null;
  let configPath: string | null = null;
  let importFlows = true;
  let importPersona = true;
  let importConfig = true;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--tenant-slug' && argv[i + 1]) tenantSlug = argv[++i];
    else if (arg === '--flows' && argv[i + 1]) flowsPath = argv[++i] ?? null;
    else if (arg === '--persona' && argv[i + 1]) personaPath = argv[++i] ?? null;
    else if (arg === '--config' && argv[i + 1]) configPath = argv[++i] ?? null;
    else if (arg === '--no-flows') importFlows = false;
    else if (arg === '--no-persona') importPersona = false;
    else if (arg === '--no-config') importConfig = false;
    else if (arg === '--dry-run') dryRun = true;
  }

  if (!tenantSlug) {
    console.error('Usage: seed-agent-config.ts --tenant-slug <slug> [--dry-run]');
    process.exit(1);
  }

  return {
    tenantSlug,
    flowsPath,
    personaPath,
    configPath,
    importFlows,
    importPersona,
    importConfig,
    dryRun,
  };
}

/** Stringify estable (claves ordenadas) para comparar definiciones sin sesgo de orden. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs();
  const log = pino({ level: 'info' });

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    log.error('DATABASE_URL is required');
    process.exit(1);
  }
  const db = createDb(databaseUrl);

  if (opts.dryRun) log.info('DRY RUN — no se escribirá nada en la base de datos');

  // 1. Resolver tenant
  const [tenant] = await db
    .select({ id: tenants.id, slug: tenants.slug, config: tenants.config })
    .from(tenants)
    .where(eq(tenants.slug, opts.tenantSlug))
    .limit(1);

  if (!tenant) {
    log.error({ slug: opts.tenantSlug }, 'tenant no encontrado');
    process.exit(1);
  }
  log.info({ tenant: tenant.slug, id: tenant.id }, 'tenant resuelto');

  // Config acumulada del tenant — los pasos de config/persona mergean sobre esta
  // misma referencia para no pisarse entre ellos en una sola corrida.
  let workingConfig = (tenant.config ?? {}) as Record<string, unknown>;

  // 2. Flows declarativos
  if (opts.importFlows) {
    const flowsPath = opts.flowsPath ?? resolve(SEEDS_DIR, `flows-${opts.tenantSlug}.json`);
    let rawFlows: unknown;
    try {
      rawFlows = JSON.parse(readFileSync(flowsPath, 'utf8'));
    } catch (err) {
      log.error({ flowsPath, err: String(err) }, 'no se pudo leer el archivo de flows');
      process.exit(1);
    }

    if (!Array.isArray(rawFlows)) {
      log.error({ flowsPath }, 'el archivo de flows debe ser un array');
      process.exit(1);
    }

    let created = 0;
    let skipped = 0;
    for (const raw of rawFlows) {
      const parsed = FlowDefinitionSchema.safeParse(raw);
      if (!parsed.success) {
        log.error(
          { issues: parsed.error.issues, flow: (raw as { flow_id?: string })?.flow_id },
          'flow inválido — abortando',
        );
        process.exit(1);
      }
      const def: FlowDefinition = parsed.data;

      // ¿Ya existe una versión activa idéntica? → idempotente, omitir.
      const [active] = await db
        .select({ version: flowDefinitions.version, definition: flowDefinitions.definition })
        .from(flowDefinitions)
        .where(
          and(
            eq(flowDefinitions.tenantId, tenant.id),
            eq(flowDefinitions.flowId, def.flow_id),
            eq(flowDefinitions.active, true),
          ),
        )
        .limit(1);

      if (active && stableStringify(active.definition) === stableStringify(def)) {
        log.info({ flow: def.flow_id, version: active.version }, 'flow sin cambios — omitido');
        skipped++;
        continue;
      }

      if (opts.dryRun) {
        log.info({ flow: def.flow_id, action: active ? 'nueva versión' : 'alta' }, 'DRY: flow');
        created++;
        continue;
      }

      await db.transaction(async (tx) => {
        const [latest] = await tx
          .select({ version: flowDefinitions.version })
          .from(flowDefinitions)
          .where(
            and(eq(flowDefinitions.tenantId, tenant.id), eq(flowDefinitions.flowId, def.flow_id)),
          )
          .orderBy(desc(flowDefinitions.version))
          .limit(1);
        const nextVersion = (latest?.version ?? 0) + 1;

        await tx
          .update(flowDefinitions)
          .set({ active: false })
          .where(
            and(
              eq(flowDefinitions.tenantId, tenant.id),
              eq(flowDefinitions.flowId, def.flow_id),
              eq(flowDefinitions.active, true),
            ),
          );

        await tx.insert(flowDefinitions).values({
          tenantId: tenant.id,
          flowId: def.flow_id,
          version: nextVersion,
          definition: def,
          active: true,
        });
        log.info({ flow: def.flow_id, version: nextVersion }, 'flow activado');
      });
      created++;
    }
    log.info({ created, skipped, total: rawFlows.length }, 'flows importados');
  }

  // 3. Config del tenant (claves de tenants.config version-controladas, p. ej.
  //    text_policy_by_stage para la regla "camino feliz sin texto del LLM").
  //    El archivo es OPCIONAL: si no existe, se omite sin error.
  if (opts.importConfig) {
    const configPath = opts.configPath ?? resolve(SEEDS_DIR, `config-${opts.tenantSlug}.json`);
    let rawConfig: unknown;
    try {
      rawConfig = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch {
      rawConfig = null; // archivo ausente o ilegible → opcional, se omite
    }

    if (rawConfig != null) {
      if (typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
        log.error({ configPath }, 'config-<slug>.json debe ser un objeto');
        process.exit(1);
      }
      const partial = rawConfig as Record<string, unknown>;
      const merged = { ...workingConfig, ...partial };
      // Validar el resultado completo contra el esquema del tenant.
      const parsed = TenantConfigSchema.safeParse(merged);
      if (!parsed.success) {
        log.error({ issues: parsed.error.issues, configPath }, 'config inválida — abortando');
        process.exit(1);
      }
      if (stableStringify(workingConfig) === stableStringify(merged)) {
        log.info('config sin cambios — omitida');
      } else if (opts.dryRun) {
        log.info({ keys: Object.keys(partial) }, 'DRY: config se mergearía');
        workingConfig = merged;
      } else {
        await db
          .update(tenants)
          .set({ config: sql`${JSON.stringify(merged)}::jsonb`, updatedAt: sql`now()` })
          .where(eq(tenants.id, tenant.id));
        workingConfig = merged;
        log.info({ keys: Object.keys(partial) }, 'config mergeada');
      }
    }
  }

  // 4. Persona
  if (opts.importPersona) {
    const personaPath = opts.personaPath ?? resolve(SEEDS_DIR, `persona-${opts.tenantSlug}.md`);
    let persona: string;
    try {
      persona = readFileSync(personaPath, 'utf8').trim();
    } catch (err) {
      log.error({ personaPath, err: String(err) }, 'no se pudo leer la persona');
      process.exit(1);
    }

    if (workingConfig.persona_prompt === persona) {
      log.info('persona sin cambios — omitida');
    } else if (opts.dryRun) {
      log.info({ chars: persona.length }, 'DRY: persona se actualizaría');
    } else {
      const nextConfig = { ...workingConfig, persona_prompt: persona };
      await db
        .update(tenants)
        .set({ config: sql`${JSON.stringify(nextConfig)}::jsonb`, updatedAt: sql`now()` })
        .where(eq(tenants.id, tenant.id));
      workingConfig = nextConfig;
      log.info({ chars: persona.length }, 'persona actualizada');
    }
  }

  log.info('seed-agent-config completado');
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed-agent-config] failed', err);
  process.exit(1);
});
