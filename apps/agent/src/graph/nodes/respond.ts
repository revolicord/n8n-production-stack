import { conversations, messagesRaw, turns } from '@dm-api/db';
import type { ActionResult, AgentResponse, DialogueCommand } from '@dm-api/shared';
import { eq, sql } from 'drizzle-orm';
import type { FlowEngineResult } from '../../core/flow-engine/engine.js';
import type { Deps } from '../../deps.js';
import { saveDialogueState } from '../../services/dialogue-states.js';
import type { GraphState, LlmCallMetrics } from '../annotation.js';

export async function respondNode(
  state: GraphState,
  commands: DialogueCommand[],
  flowResult: FlowEngineResult,
  actionResults: ActionResult[],
  responseTexts: string[],
  finalStage: string,
  _ctx: unknown,
  deps: Deps,
  llmMetrics: LlmCallMetrics | null,
  status: AgentResponse['status'],
  interruptInfo?: { reason: string; notification_id: string } | undefined,
): Promise<AgentResponse> {
  const { input } = state;
  const totalMs = Date.now() - state.startedAt;

  if (!input.dry_run) {
    // Persist turn completion
    await deps.db
      .update(turns)
      .set({
        status: status === 'interrupted' ? 'interrupted' : 'completed',
        responseText: responseTexts.join('\n') || null,
        llmModel: llmMetrics?.model ?? null,
        inputTokens: llmMetrics?.inputTokens ?? null,
        outputTokens: llmMetrics?.outputTokens ?? null,
        completedAt: sql`now()`,
        durationMs: totalMs,
      })
      .where(eq(turns.id, input.turn_id));

    // Persist outbound messages to messages_raw
    for (const text of responseTexts) {
      const hash = `out:${input.turn_id}:${text.slice(0, 20)}`;
      await deps.db
        .insert(messagesRaw)
        .values({
          tenantId: input.tenant_id,
          subscriberId: input.subscriber_id,
          channel: input.trigger.channel ?? 'instagram',
          externalMessageId: null,
          idempotencyHash: hash,
          direction: 'out',
          payload: { turn_id: input.turn_id },
          text,
          hasMedia: false,
          mediaUrls: [],
        })
        .onConflictDoNothing();
    }

    // Persist dialogue state
    await saveDialogueState(deps.db, {
      conversationId: input.conversation_id,
      tenantId: input.tenant_id,
      state: {
        ...flowResult.state,
        last_turn_id: input.turn_id,
      },
      turnId: input.turn_id,
    });

    // Touch bot message timestamp
    await deps.db
      .update(conversations)
      .set({ lastBotMsgAt: sql`now()` })
      .where(eq(conversations.id, input.conversation_id));
  }

  const response: AgentResponse = {
    turn_id: input.turn_id,
    status,
    commands,
    action_results: actionResults,
    response_texts: responseTexts,
    final_stage: finalStage,
    dialogue_state: flowResult.state,
    interrupt: interruptInfo,
    metrics: {
      model: llmMetrics?.model ?? null,
      input_tokens: llmMetrics?.inputTokens ?? null,
      output_tokens: llmMetrics?.outputTokens ?? null,
      llm_ms: llmMetrics?.llmMs ?? null,
      total_ms: totalMs,
    },
  };

  return response;
}
