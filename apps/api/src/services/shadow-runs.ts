import { agentShadowRuns } from '@dm-api/db';
import type { DbClient } from '@dm-api/db';
import type { AgentResponse } from '@dm-api/shared';

export async function saveShadowRun(
  db: DbClient,
  turnId: string,
  res: AgentResponse,
): Promise<void> {
  await db
    .insert(agentShadowRuns)
    .values({
      turnId,
      tenantId: res.dialogue_state.last_turn_id ?? turnId,
      commands: res.commands,
      responseTexts: res.response_texts,
      finalStage: res.final_stage,
      dialogueState: res.dialogue_state,
      error: res.status === 'failed' ? `status:${res.status}` : null,
      durationMs: res.metrics.total_ms,
    })
    .onConflictDoNothing();
}
