import type { AgentResponse, TurnInput } from '@dm-api/shared';
import { getAgentConfig } from './config.js';
import { getDeps } from './deps.js';
import { runGraph } from './graph/build-graph.js';

export async function runTurn(input: TurnInput): Promise<AgentResponse> {
  const config = getAgentConfig();
  const deps = getDeps();
  const log = deps.logger.child({ turn_id: input.turn_id, tenant_id: input.tenant_id });

  const timeoutMs = config.AGENT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await Promise.race([
      runGraph(input, { ...deps, logger: log }),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () =>
          reject(new Error(`agent turn timeout after ${timeoutMs}ms`)),
        );
      }),
    ]);
    return response;
  } finally {
    clearTimeout(timer);
  }
}
