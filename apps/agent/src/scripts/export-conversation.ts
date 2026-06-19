/**
 * export-conversation.ts — Fase 4 del feedback loop (ver docs/business-rules-qc.md).
 *
 * Exporta una conversación a un markdown legible que entrelaza, turno a turno:
 *   - lo que dijo el lead
 *   - lo que RAZONÓ el agente (reasoning del LLM)
 *   - lo que DECIDIÓ (commands + flow path)
 *   - lo que RESPONDIÓ (response_texts + acciones)
 *   - la etapa antes→después
 * con huecos de FEEDBACK para que el cliente anote la respuesta deseada.
 *
 * Además genera un BUNDLE con el corpus completo de reglas del tenant (persona,
 * skeleton, etapas, transiciones, contenido, flows, políticas) para que la IA experta
 * audite sin diagnosticar a ciegas.
 *
 * Uso (local, con DATABASE_URL):
 *   tsx apps/agent/scripts/export-conversation.ts --conversation-id <uuid>
 *   tsx apps/agent/scripts/export-conversation.ts --conversation-id <uuid> --out ./out
 *   tsx apps/agent/scripts/export-conversation.ts --conversation-id <uuid> --no-bundle
 *
 * En prod: ver `make export-conversation CONV=<uuid>`.
 *
 * La fuente es `agent_turn_traces`. El reasoning/prompt solo existen si el tenant corre
 * con trace_level=full (ver docs/langsmith-langgraph-observabilidad.md).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import {
  agentTurnTraces,
  createDb,
  flowDefinitions,
  funnelStages,
  stageFlows,
  stageTransitionsMap,
  tenants,
} from '@dm-api/db';
import { and, asc, eq } from 'drizzle-orm';
import { pino } from 'pino';

const log = pino({ level: 'info' });

// ─── CLI args ────────────────────────────────────────────────────────────────
interface Args {
  conversationId: string;
  outDir: string;
  mode: string;
  bundle: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let conversationId: string | undefined;
  let outDir = './agent-tuning-out';
  let mode = 'live';
  let bundle = true;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--conversation-id' && argv[i + 1]) conversationId = argv[++i];
    else if (arg === '--out' && argv[i + 1]) outDir = argv[++i] ?? outDir;
    else if (arg === '--mode' && argv[i + 1]) mode = argv[++i] ?? mode;
    else if (arg === '--no-bundle') bundle = false;
  }

  if (!conversationId) {
    console.error(
      'Usage: export-conversation.ts --conversation-id <uuid> [--out <dir>] [--no-bundle]',
    );
    process.exit(1);
  }
  return { conversationId, outDir, mode, bundle };
}

// ─── Helpers de render ───────────────────────────────────────────────────────
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function jsonBlock(v: unknown): string {
  if (v == null) return '_(vacío)_';
  const s = JSON.stringify(v, null, 2);
  return s.length > 4000 ? `${s.slice(0, 4000)}\n… (truncado)` : s;
}

function compact(v: unknown): string {
  if (v == null) return '—';
  const s = JSON.stringify(v);
  return s.length > 600 ? `${s.slice(0, 600)}…` : s;
}

interface TraceRow {
  id: string;
  createdAt: Date | null;
  status: string;
  input: unknown;
  reasoning: string | null;
  commands: unknown;
  flowPath: unknown;
  actionResults: unknown;
  responseTexts: unknown;
  finalStage: string | null;
  dialogueStateBefore: unknown;
  dialogueStateAfter: unknown;
  metrics: unknown;
}

function renderLeadMessages(input: unknown): string {
  const messages = asArray((input as { messages?: unknown })?.messages);
  if (messages.length === 0) return '_(sin mensajes — turno de sistema)_';
  return messages
    .map((m) => {
      const msg = m as { text?: string | null; content_class?: string };
      const cls = msg.content_class ? ` _(${msg.content_class})_` : '';
      return `> ${msg.text ?? '(sin texto)'}${cls}`;
    })
    .join('\n');
}

function renderResponses(responseTexts: unknown): string {
  const texts = asArray(responseTexts);
  if (texts.length === 0) return '_(el agente no envió texto este turno)_';
  return texts.map((t) => `> ${String(t)}`).join('\n');
}

const FEEDBACK_BLOCK = [
  '<!-- ╔═══ FEEDBACK DEL CLIENTE — rellena SOLO si esta respuesta no te gustó ═══╗ -->',
  '<!-- veredicto: ok | mal                                                       -->',
  '<!-- respuesta_deseada:                                                        -->',
  '<!-- por_que (registro seco/suave/tajante · etapa · contenido · timing):       -->',
  '<!-- ╚═════════════════════════════════════════════════════════════════════════╝ -->',
].join('\n');

function renderTurn(t: TraceRow, n: number, prevStage: string): string {
  const after = t.finalStage ?? prevStage;
  const ts = t.createdAt ? new Date(t.createdAt).toISOString() : '—';

  return [
    `### Turno ${n} — etapa ${prevStage} → ${after}  ·  ${t.status}  ·  ${ts}`,
    '',
    '**Lead:**',
    renderLeadMessages(t.input),
    '',
    '**Razonó (LLM):**',
    t.reasoning ? `_${t.reasoning}_` : '_(sin reasoning — ¿trace_level=full?)_',
    '',
    `**Decidió:** \`commands\`: ${compact(t.commands)}`,
    `**Flow path:** ${compact(t.flowPath)}`,
    '',
    '**Respondió:**',
    renderResponses(t.responseTexts),
    '',
    '<details><summary>acciones / estado / métricas</summary>',
    '',
    '```json',
    jsonBlock({
      action_results: t.actionResults,
      dialogue_state_after: t.dialogueStateAfter,
      metrics: t.metrics,
    }),
    '```',
    '</details>',
    '',
    FEEDBACK_BLOCK,
    '',
    '---',
  ].join('\n');
}

// ─── Bundle de reglas ────────────────────────────────────────────────────────
async function renderBundle(
  db: ReturnType<typeof createDb>,
  tenant: { id: string; slug: string; config: unknown },
): Promise<string> {
  const cfg = (tenant.config ?? {}) as Record<string, unknown>;

  const stages = await db
    .select()
    .from(funnelStages)
    .where(and(eq(funnelStages.tenantId, tenant.id), eq(funnelStages.isActive, true)))
    .orderBy(asc(funnelStages.position));

  const transitions = await db
    .select()
    .from(stageTransitionsMap)
    .where(and(eq(stageTransitionsMap.tenantId, tenant.id), eq(stageTransitionsMap.isActive, true)))
    .orderBy(asc(stageTransitionsMap.fromStageSlug));

  const content = await db
    .select({
      stageSlug: funnelStages.slug,
      stagePos: funnelStages.position,
      slugId: stageFlows.slugId,
      humanName: stageFlows.humanName,
      mediaType: stageFlows.mediaType,
      contentDescription: stageFlows.contentDescription,
      usageCondition: stageFlows.usageCondition,
    })
    .from(stageFlows)
    .innerJoin(funnelStages, eq(funnelStages.id, stageFlows.stageId))
    .where(and(eq(stageFlows.tenantId, tenant.id), eq(stageFlows.isActive, true)))
    .orderBy(asc(funnelStages.position));

  const flows = await db
    .select()
    .from(flowDefinitions)
    .where(and(eq(flowDefinitions.tenantId, tenant.id), eq(flowDefinitions.active, true)))
    .orderBy(asc(flowDefinitions.flowId));

  const lines: string[] = [
    `# Bundle de reglas — tenant ${tenant.slug}`,
    '',
    '> Corpus completo que ve (proyectado) el agente. La fuente de verdad legible es',
    '> `docs/business-rules-qc.md`. Si algo aquí contradice ese doc, el doc manda.',
    '',
    '## Persona (system prompt del tenant)',
    '',
    '```',
    String(cfg.persona_prompt ?? '(sin persona)'),
    '```',
    '',
  ];

  if (cfg.skeleton_prompt) {
    lines.push(
      '## Skeleton de plataforma (compartido — NO editar por tenant)',
      '',
      '```',
      String(cfg.skeleton_prompt),
      '```',
      '',
    );
  }

  lines.push('## Etapas (funnel_stages)', '');
  lines.push('| slug | nombre | pos | terminal | goal | description | valid_next |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const s of stages) {
    lines.push(
      `| ${s.slug} | ${s.displayName} | ${s.position} | ${s.isTerminal} | ${s.goal ?? ''} | ${s.description ?? ''} | ${(s.validNextStages ?? []).join(', ')} |`,
    );
  }

  lines.push('', '## Transiciones activas (stage_transitions_map)', '');
  lines.push('| from → to | when_to_use |');
  lines.push('|---|---|');
  for (const tr of transitions) {
    lines.push(`| ${tr.fromStageSlug} → ${tr.toStageSlug} | ${tr.whenToUse} |`);
  }

  lines.push('', '## Contenido por etapa (stage_flows)', '');
  lines.push('| etapa | slug_id | tipo | descripción | usage_condition |');
  lines.push('|---|---|---|---|---|');
  for (const c of content) {
    lines.push(
      `| ${c.stageSlug} | ${c.slugId ?? ''} | ${c.mediaType ?? ''} | ${c.contentDescription ?? ''} | ${c.usageCondition ?? ''} |`,
    );
  }

  lines.push('', '## Cascadas declarativas (flow_definitions)', '');
  for (const f of flows) {
    lines.push(
      `- **${f.flowId}** (v${f.version}) — \`${compact((f.definition as { trigger?: unknown })?.trigger)}\``,
    );
  }

  lines.push(
    '',
    '## Políticas de texto (text_policy_by_stage)',
    '',
    '```json',
    JSON.stringify(cfg.text_policy_by_stage ?? cfg.text_policy_default ?? {}, null, 2),
    '```',
    '',
  );

  return lines.join('\n');
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const opts = parseArgs();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    log.error('DATABASE_URL is required');
    process.exit(1);
  }
  const db = createDb(databaseUrl);

  const traces = (await db
    .select({
      id: agentTurnTraces.id,
      createdAt: agentTurnTraces.createdAt,
      status: agentTurnTraces.status,
      tenantId: agentTurnTraces.tenantId,
      input: agentTurnTraces.input,
      reasoning: agentTurnTraces.reasoning,
      commands: agentTurnTraces.commands,
      flowPath: agentTurnTraces.flowPath,
      actionResults: agentTurnTraces.actionResults,
      responseTexts: agentTurnTraces.responseTexts,
      finalStage: agentTurnTraces.finalStage,
      dialogueStateBefore: agentTurnTraces.dialogueStateBefore,
      dialogueStateAfter: agentTurnTraces.dialogueStateAfter,
      metrics: agentTurnTraces.metrics,
    })
    .from(agentTurnTraces)
    .where(
      and(
        eq(agentTurnTraces.conversationId, opts.conversationId),
        eq(agentTurnTraces.mode, opts.mode),
      ),
    )
    .orderBy(asc(agentTurnTraces.createdAt))) as Array<TraceRow & { tenantId: string }>;

  if (traces.length === 0) {
    log.error(
      { conversationId: opts.conversationId, mode: opts.mode },
      'no hay trazas para esa conversación',
    );
    process.exit(1);
  }

  mkdirSync(opts.outDir, { recursive: true });

  // 1. Transcript anotable
  const header = [
    `# Conversación ${opts.conversationId}`,
    '',
    `Turnos: ${traces.length} · modo: ${opts.mode}`,
    '',
    'Lee cada turno y, donde el agente respondió algo que NO te gustó, rellena el bloque',
    'FEEDBACK con la respuesta deseada y por qué. Luego pásale este archivo + el bundle a la',
    'IA experta (ver docs/agent-tuning/expert-system-prompt.md).',
    '',
    '---',
    '',
  ].join('\n');
  let prevStage = '(inicio)';
  const body = traces
    .map((t, i) => {
      const md = renderTurn(t, i + 1, prevStage);
      prevStage = t.finalStage ?? prevStage;
      return md;
    })
    .join('\n');
  const convPath = resolve(opts.outDir, `${opts.conversationId}.conversation.md`);
  writeFileSync(convPath, header + body, 'utf8');
  log.info({ path: convPath, turns: traces.length }, 'transcript exportado');

  // 2. Bundle de reglas del tenant
  if (opts.bundle) {
    const tenantId = traces[0]?.tenantId;
    if (tenantId) {
      const [tenant] = await db
        .select({ id: tenants.id, slug: tenants.slug, config: tenants.config })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
      if (tenant) {
        const bundle = await renderBundle(db, tenant);
        const bundlePath = resolve(opts.outDir, `${tenant.slug}.bundle.md`);
        writeFileSync(bundlePath, bundle, 'utf8');
        log.info({ path: bundlePath }, 'bundle de reglas exportado');
      }
    }
  }

  log.info('export-conversation completado');
  process.exit(0);
}

main().catch((err) => {
  console.error('[export-conversation] failed', err);
  process.exit(1);
});
