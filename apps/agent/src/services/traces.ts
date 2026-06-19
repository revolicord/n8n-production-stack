import { type DbClient, agentTurnTraces } from '@dm-api/db';
import type { DialogueState } from '@dm-api/shared';
import type { AgentStateT } from '../graph/annotation.js';

/**
 * Payload enviado al debug_webhook_url después de cada turno (ADR-0025).
 * Estructura plana y legible para inspección en n8n Executions.
 */
export interface DebugTracePayload {
  turn_id: string;
  tenant_id: string;
  subscriber_id: string;
  conversation_id: string;
  mode: TraceMode;
  status: string;
  timestamp: string;

  // Lo que dijo el lead
  input_messages: Array<{ text?: string | null; content_class?: string }>;

  // Contexto ensamblado (lo que "vio" el sistema)
  context: {
    current_stage: string | null;
    final_stage: string | null;
    valid_transitions: Array<{ from: string; to: string; when_to_use: string }>;
    content_options: Array<{ slug_id: string | null; times_sent: number }>;
    stack: unknown[];
    slots: Record<string, unknown>;
    repair_context: unknown;
    transcript_turns: number;
    active_flows: string[];
  };

  // LLM
  system_prompt: string | null;
  conversation_history: Array<{ role: string; content: string }> | null;
  reasoning: string | null;

  // Decisión
  decision_path: string;
  commands: unknown[];
  flow_path: unknown[];

  // Ejecución
  action_results: unknown[];
  response_texts: string[];

  // Antes/después del estado de diálogo
  dialogue_state_before: unknown;
  dialogue_state_after: unknown;

  // Perf
  metrics: {
    model: string | null;
    input_tokens: number | null;
    output_tokens: number | null;
    cache_read_tokens: number | null;
    cache_write_tokens: number | null;
    llm_ms: number | null;
    total_ms: number;
  };

  error: unknown;
}

/** Construye el payload de debug a partir del estado final del grafo. */
export function buildDebugPayload(
  s: AgentStateT,
  mode: TraceMode,
  status: string,
  dialogueStateAfter: DialogueState | null | undefined,
  error: TraceError | null | undefined,
): DebugTracePayload {
  const m = s.llmMetrics;
  const ctx = s.assembled;
  const transitions = (ctx?.transitions ?? []) as Array<{
    fromStageSlug: string;
    toStageSlug: string;
    whenToUse: string;
  }>;

  const currentStageCatalog = ctx?.stageCatalog?.find(
    (sc: { stageSlug: string }) => sc.stageSlug === ctx?.currentStage,
  );

  const activeFlows = ctx?.activeFlows;

  return {
    turn_id: s.input.turn_id,
    tenant_id: s.input.tenant_id,
    subscriber_id: s.input.subscriber_id,
    conversation_id: s.input.conversation_id,
    mode,
    status,
    timestamp: new Date().toISOString(),

    input_messages: s.input.messages.map((m) => ({ text: m.text, content_class: m.content_class })),

    context: {
      current_stage: ctx?.currentStage ?? null,
      final_stage: s.finalStage,
      valid_transitions: transitions
        .filter((t) => t.fromStageSlug === ctx?.currentStage)
        .map((t) => ({ from: t.fromStageSlug, to: t.toStageSlug, when_to_use: t.whenToUse })),
      content_options: (currentStageCatalog?.variants ?? []).map(
        (v: { slugId: string | null; timesSent: number }) => ({
          slug_id: v.slugId,
          times_sent: v.timesSent,
        }),
      ),
      stack: ctx?.dialogueState?.stack ?? [],
      slots: (ctx?.dialogueState?.slots as Record<string, unknown>) ?? {},
      repair_context: ctx?.dialogueState?.repair_context ?? null,
      transcript_turns: ctx?.transcript?.length ?? 0,
      active_flows: activeFlows instanceof Map ? Array.from(activeFlows.keys()) : [],
    },

    system_prompt: s.llmRequest
      ? `${s.llmRequest.systemStable}\n${s.llmRequest.systemVolatile}`
      : null,
    conversation_history: s.llmRequest?.messages ?? null,
    reasoning: s.llmReasoning,

    decision_path: s.decisionPath,
    commands: s.allCommands,
    flow_path: s.flowResult?.path ?? [],

    action_results: s.actionResults,
    response_texts: s.responseTexts,

    dialogue_state_before: s.dialogueStateBefore,
    dialogue_state_after: dialogueStateAfter ?? s.flowResult?.state ?? null,

    metrics: {
      model: m?.model ?? null,
      input_tokens: m?.inputTokens ?? null,
      output_tokens: m?.outputTokens ?? null,
      cache_read_tokens: m?.cacheReadTokens ?? null,
      cache_write_tokens: m?.cacheWriteTokens ?? null,
      llm_ms: m?.llmMs ?? null,
      total_ms: Date.now() - s.startedAt,
    },

    error: error ?? null,
  };
}

/**
 * Envía la traza de debug al webhook n8n configurado en tenant.debug_webhook_url.
 * Fire-and-forget: nunca bloquea ni hace throw — un fallo de debug no rompe el turno.
 * Solo se envía en modo 'live' (no shadow ni replay) para no saturar el webhook.
 */
export function postDebugWebhook(webhookUrl: string, payload: DebugTracePayload): void {
  fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {
    // silencioso — debug no debe romper producción
  });
}

export type TraceMode = 'live' | 'shadow' | 'replay';
export type TraceLevel = 'off' | 'metrics' | 'full';

export interface TraceError {
  node?: string | undefined;
  message: string;
  stack?: string | undefined;
}

/** Resuelve el modo de traza a partir del input del turno (ADR-0025). */
export function resolveTraceMode(input: { dry_run: boolean; run_mode?: TraceMode }): TraceMode {
  if (input.run_mode) return input.run_mode;
  return input.dry_run ? 'shadow' : 'live';
}

const SECRET_KEY_RE = /(key|token|secret|password|api_key)/i;

/** Redacta valores sensibles (api keys, tokens) de un objeto plano. */
function redact(obj: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!obj) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = SECRET_KEY_RE.test(k) ? '[redacted]' : v;
  }
  return out;
}

/**
 * Snapshot serializable y sin secretos del contexto que vio el LLM. Evita los
 * Map (activeFlows) y redacta tenantConfig. Solo se guarda con trace_level=full.
 */
function serializeContext(ctx: AgentStateT['assembled']): Record<string, unknown> | null {
  if (!ctx) return null;
  const c = ctx as unknown as Record<string, unknown>;
  const activeFlows = c.activeFlows;
  return {
    tenant_config: redact(c.tenantConfig as Record<string, unknown>),
    current_stage: c.currentStage ?? null,
    transitions: c.transitions ?? null,
    stage_catalog: c.stageCatalog ?? null,
    handoff_state: c.handoffState ?? null,
    lead_content_sent: c.leadContentSent ?? null,
    transcript: c.transcript ?? null,
    active_flows:
      activeFlows instanceof Map ? Array.from(activeFlows.keys()) : (activeFlows ?? null),
  };
}

/**
 * Persiste la traza legible del turno en agent_turn_traces (ADR-0025).
 * Idempotente por (turn_id, mode). Gobernada por trace_level del tenant.
 */
export async function saveTurnTrace(
  db: DbClient,
  args: {
    state: AgentStateT;
    mode: TraceMode;
    status: string;
    traceLevel: TraceLevel;
    dialogueStateAfter?: DialogueState | null;
    error?: TraceError | null;
  },
): Promise<void> {
  if (args.traceLevel === 'off') return;
  const s = args.state;
  const full = args.traceLevel === 'full';
  const m = s.llmMetrics;

  await db
    .insert(agentTurnTraces)
    .values({
      turnId: s.input.turn_id,
      tenantId: s.input.tenant_id,
      conversationId: s.input.conversation_id,
      subscriberId: s.input.subscriber_id,
      mode: args.mode,
      status: args.status,
      decisionPath: s.decisionPath,
      input: s.input,
      contextSnapshot: full ? serializeContext(s.assembled) : null,
      prompt: full ? s.llmRequest : null,
      reasoning: s.llmReasoning,
      commands: s.allCommands,
      actionResults: s.actionResults,
      flowPath: s.flowResult?.path ?? null,
      responseTexts: s.responseTexts,
      finalStage: s.finalStage,
      dialogueStateBefore: s.dialogueStateBefore,
      dialogueStateAfter: args.dialogueStateAfter ?? s.flowResult?.state ?? null,
      error: args.error ?? null,
      metrics: {
        model: m?.model ?? null,
        input_tokens: m?.inputTokens ?? null,
        output_tokens: m?.outputTokens ?? null,
        cache_read_tokens: m?.cacheReadTokens ?? null,
        cache_write_tokens: m?.cacheWriteTokens ?? null,
        llm_ms: m?.llmMs ?? null,
        total_ms: Date.now() - s.startedAt,
      },
    })
    .onConflictDoNothing();
}
