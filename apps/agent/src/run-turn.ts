import type { AgentResponse, TurnInput } from '@dm-api/shared';
import { getAgentConfig } from './config.js';
import { ensureCheckpointerSetup, getDeps } from './deps.js';
import { type AgentStateT, initialState } from './graph/annotation.js';
import { getCompiledGraph } from './graph/build-graph.js';
import { type TraceLevel, resolveTraceMode, saveTurnTrace } from './services/traces.js';

export async function runTurn(input: TurnInput): Promise<AgentResponse> {
  const config = getAgentConfig();
  const deps = getDeps();
  const log = deps.logger.child({ turn_id: input.turn_id, tenant_id: input.tenant_id });
  const startedAt = Date.now();

  await ensureCheckpointerSetup();
  const graph = getCompiledGraph(deps);

  // dry_run (shadow/replay) corre en un thread AISLADO para no tocar el
  // checkpoint del thread real de la conversación (ADR-0025).
  const threadId = input.dry_run
    ? `shadow:${input.conversation_id}:${input.turn_id}`
    : input.conversation_id;
  const threadConfig = { configurable: { thread_id: threadId } };

  const timeoutMs = config.AGENT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const finalState = await graph.invoke(initialState(input), {
      ...threadConfig,
      signal: controller.signal,
      recursionLimit: 50,
    });
    const response = finalState.agentResponse;
    if (!response) throw new Error('agent graph produced no response');
    return response;
  } catch (err) {
    log.error({ err }, 'agent turn failed');
    await persistFailedTrace(graph, threadConfig, input, startedAt, err, log);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Traza de fallo (ADR-0025): captura el estado parcial + nodo + stack. */
async function persistFailedTrace(
  graph: ReturnType<typeof getCompiledGraph>,
  threadConfig: { configurable: { thread_id: string } },
  input: TurnInput,
  startedAt: number,
  err: unknown,
  log: ReturnType<typeof getDeps>['logger'],
): Promise<void> {
  try {
    let partial: Partial<AgentStateT> = {};
    let failedNode: string | undefined;
    try {
      const snap = await graph.getState(threadConfig);
      partial = (snap.values ?? {}) as Partial<AgentStateT>;
      failedNode = snap.next?.[0];
    } catch {
      // sin checkpoint (falló antes del primer paso) — traza mínima
    }
    const state = { ...partial, input, startedAt } as AgentStateT;
    const traceLevel =
      (state.assembled?.tenantConfig.trace_level as TraceLevel | undefined) ?? 'full';
    await saveTurnTrace(getDeps().db, {
      state,
      mode: resolveTraceMode(input),
      status: 'failed',
      traceLevel,
      error: {
        node: failedNode,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
    });
  } catch (traceErr) {
    log.error({ err: traceErr, turn_id: input.turn_id }, 'persistFailedTrace failed');
  }
}
