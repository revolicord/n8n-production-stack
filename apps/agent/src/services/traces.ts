import { type DbClient, agentTurnTraces } from '@dm-api/db';
import type { DialogueState } from '@dm-api/shared';
import type { AgentStateT } from '../graph/annotation.js';

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
        llm_ms: m?.llmMs ?? null,
        total_ms: Date.now() - s.startedAt,
      },
    })
    .onConflictDoNothing();
}
