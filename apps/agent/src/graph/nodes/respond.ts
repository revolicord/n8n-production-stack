import { conversations, messagesRaw, turns } from '@dm-api/db';
import type { AgentResponse } from '@dm-api/shared';
import { eq, sql } from 'drizzle-orm';
import type { Deps } from '../../deps.js';
import { saveDialogueState } from '../../services/dialogue-states.js';
import {
  type TraceLevel,
  buildDebugPayload,
  postDebugWebhook,
  resolveTraceMode,
  saveTurnTrace,
} from '../../services/traces.js';
import type { AgentStateT } from '../annotation.js';

/**
 * Nodo final: persiste el turno (salvo dry_run), proyecta la memoria a
 * `dialogue_states` (fuente de verdad legible, ADR-0025) y construye la
 * `AgentResponse`. La traza legible (`agent_turn_traces`) se persiste aparte
 * en Fase C.
 */
export async function respondNode(state: AgentStateT, deps: Deps): Promise<Partial<AgentStateT>> {
  const { input } = state;
  const flowResult = state.flowResult;
  if (!flowResult) throw new Error('respondNode: flowResult missing');

  const totalMs = Date.now() - state.startedAt;
  const llmMetrics = state.llmMetrics;
  const responseTexts = state.responseTexts;
  const status: AgentResponse['status'] = state.status ?? (input.dry_run ? 'dry_run' : 'completed');
  const finalStage = state.finalStage ?? '';

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

    // Project dialogue memory to dialogue_states (canonical readable source)
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
    commands: state.allCommands,
    action_results: state.actionResults,
    response_texts: responseTexts,
    final_stage: finalStage,
    dialogue_state: flowResult.state,
    interrupt: state.interruptInfo ?? undefined,
    metrics: {
      model: llmMetrics?.model ?? null,
      input_tokens: llmMetrics?.inputTokens ?? null,
      output_tokens: llmMetrics?.outputTokens ?? null,
      llm_ms: llmMetrics?.llmMs ?? null,
      total_ms: totalMs,
    },
  };

  // Traza legible (ADR-0025) — best-effort, también en shadow/dry_run.
  const traceLevel =
    (state.assembled?.tenantConfig.trace_level as TraceLevel | undefined) ?? 'full';
  const traceMode = resolveTraceMode(input);
  try {
    await saveTurnTrace(deps.db, {
      state,
      mode: traceMode,
      status,
      traceLevel,
      dialogueStateAfter: flowResult.state,
    });
  } catch (err) {
    deps.logger.error({ err, turn_id: input.turn_id }, 'saveTurnTrace failed');
  }

  // Debug webhook: POST a n8n si está configurado (solo live, fire-and-forget).
  const debugUrl = state.assembled?.tenantConfig.debug_webhook_url as string | undefined;
  if (debugUrl && traceMode === 'live') {
    postDebugWebhook(debugUrl, buildDebugPayload(state, traceMode, status, flowResult.state, null));
  }

  deps.logger
    .child({ turn_id: input.turn_id, node: 'respond' })
    .info({ status, final_stage: finalStage, total_ms: totalMs }, 'turn responded');

  return { agentResponse: response, status };
}
