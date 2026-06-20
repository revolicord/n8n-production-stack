import { type DbClient, agentTurnTraces } from '@dm-api/db';
import { and, eq, gte, sql } from 'drizzle-orm';

/** Una fila de agregación por `decision_path`. */
interface DecisionRow {
  decisionPath: string | null;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export interface AgentSavings {
  window_days: number;
  mode: string;
  total_turns: number;
  /** Desglose crudo de turnos por camino de decisión. */
  by_decision_path: {
    fast_path: number;
    stuck_breaker: number;
    system: number;
    llm: number;
    none: number;
  };
  /** Turnos resueltos SIN llamar al LLM (CALM determinista + eventos de sistema). */
  deterministic_turns: number;
  /** % de turnos deterministas sobre el total (0 tokens de razonamiento). */
  deterministic_pct: number;
  llm_turns: number;
  /** Tokens de input realmente gastados en las llamadas al LLM. */
  input_tokens_used: number;
  /** Media de tokens de input por turno LLM (base de la estimación de ahorro). */
  avg_input_tokens_per_llm: number;
  /**
   * Estimación de tokens de input AHORRADOS: cada turno determinista habría
   * costado ~`avg_input_tokens_per_llm` si hubiera ido al LLM. Demuestra el
   * ahorro de la arquitectura CALM/Rasa frente a un agente LLM-en-cada-turno.
   */
  estimated_input_tokens_saved: number;
}

/**
 * Agrega `agent_turn_traces` para demostrar el ahorro determinista de la
 * arquitectura CALM: cuántos turnos se resolvieron sin LLM y los tokens que eso
 * evitó. Tenant-scoped, ventana de `days` días, sobre el modo indicado (live).
 */
export async function getAgentSavings(
  db: DbClient,
  args: { tenantId: string; days: number; mode?: string },
): Promise<AgentSavings> {
  const mode = args.mode ?? 'live';
  const since = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000);

  const rows = (await db
    .select({
      decisionPath: agentTurnTraces.decisionPath,
      turns: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum((${agentTurnTraces.metrics}->>'input_tokens')::bigint), 0)::int`,
      outputTokens: sql<number>`coalesce(sum((${agentTurnTraces.metrics}->>'output_tokens')::bigint), 0)::int`,
      cacheReadTokens: sql<number>`coalesce(sum((${agentTurnTraces.metrics}->>'cache_read_tokens')::bigint), 0)::int`,
    })
    .from(agentTurnTraces)
    .where(
      and(
        eq(agentTurnTraces.tenantId, args.tenantId),
        eq(agentTurnTraces.mode, mode),
        gte(agentTurnTraces.createdAt, since),
      ),
    )
    .groupBy(agentTurnTraces.decisionPath)) as DecisionRow[];

  const counts = { fast_path: 0, stuck_breaker: 0, system: 0, llm: 0, none: 0 };
  let llmInputTokens = 0;
  for (const r of rows) {
    const key = (r.decisionPath ?? 'none') as keyof typeof counts;
    counts[key in counts ? key : 'none'] += r.turns;
    if (r.decisionPath === 'llm') llmInputTokens += r.inputTokens;
  }

  const totalTurns =
    counts.fast_path + counts.stuck_breaker + counts.system + counts.llm + counts.none;
  const deterministicTurns = counts.fast_path + counts.stuck_breaker + counts.system;
  const avgInputPerLlm = counts.llm > 0 ? Math.round(llmInputTokens / counts.llm) : 0;

  return {
    window_days: args.days,
    mode,
    total_turns: totalTurns,
    by_decision_path: counts,
    deterministic_turns: deterministicTurns,
    deterministic_pct:
      totalTurns > 0 ? Math.round((deterministicTurns / totalTurns) * 1000) / 10 : 0,
    llm_turns: counts.llm,
    input_tokens_used: llmInputTokens,
    avg_input_tokens_per_llm: avgInputPerLlm,
    estimated_input_tokens_saved: deterministicTurns * avgInputPerLlm,
  };
}
