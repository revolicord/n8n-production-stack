import type { AgentResponse, TurnInput } from '@dm-api/shared';
import type { Logger } from '../lib/logger.js';

let runTurnFn: ((input: TurnInput) => Promise<AgentResponse>) | null = null;

async function getRunner(): Promise<(input: TurnInput) => Promise<AgentResponse>> {
  if (!runTurnFn) {
    const mod = await import('@dm-api/agent');
    runTurnFn = mod.runTurn;
  }
  return runTurnFn;
}

export async function dispatchToAgent(opts: {
  input: TurnInput;
  log: Logger;
}): Promise<AgentResponse> {
  const runner = await getRunner();
  const res = await runner(opts.input);
  opts.log.info(
    { turn_id: res.turn_id, status: res.status, final_stage: res.final_stage },
    'agent turn done',
  );
  return res;
}
