import type { AgentResponse, TurnInput } from '@dm-api/shared';
import { notifyHumanHandler } from '../actions/handlers/notify-human.js';
import { setRepairContext } from '../core/flow-engine/repair.js';
import type { Deps } from '../deps.js';
import { saveDialogueState } from '../services/dialogue-states.js';
import { initialState } from './annotation.js';
import { assembleContextNode } from './nodes/assemble-context.js';
import { executeActionsNode } from './nodes/execute-actions.js';
import { flowEngineNode } from './nodes/flow-engine.js';
import { respondNode } from './nodes/respond.js';
import { understandNode } from './nodes/understand.js';

export async function runGraph(input: TurnInput, deps: Deps): Promise<AgentResponse> {
  const state = initialState(input);

  // 1. Assemble context
  const ctx = await assembleContextNode(state, deps);
  state.assembled = ctx;

  // 2. Understand (LLM or skip)
  const { commands, metrics } = await understandNode(state, ctx, deps);
  state.llmPlan = null;
  state.allCommands = commands;
  state.llmMetrics = metrics;

  // 3. Flow engine (pure TS)
  const flowResult = flowEngineNode(state, ctx, commands);
  state.flowResult = flowResult;

  // Handle HumanHandoff interrupt
  if (flowResult.interrupt) {
    const { reason, kind, summary } = flowResult.interrupt;

    let notificationId: string | undefined;

    if (!input.dry_run) {
      // Create notification via handler
      const notifResult = await notifyHumanHandler.execute(
        {
          action: 'notify_human',
          config: { kind, reason, summary },
          on_failure: 'continue',
          origin: 'command',
        },
        {
          tenant: ctx.tenant,
          tenantConfig: ctx.tenantConfig,
          subscriber: ctx.subscriber,
          conversationId: input.conversation_id,
          turnId: input.turn_id,
          channel: {
            sendFlow: async () => ({ success: true, statusCode: 0, attempts: 0 }),
            sendText: async () => ({ success: true, statusCode: 0, attempts: 0 }),
          },
          db: deps.db,
          redis: deps.redis,
          log: deps.logger,
          dryRun: false,
          stageCatalog: ctx.stageCatalog,
          currentStage: ctx.currentStage,
        },
      );
      notificationId = (notifResult.detail as { notification_id?: string }).notification_id;

      // Persist dialogue state with human_handoff repair context
      const interruptedState = setRepairContext(
        flowResult.state,
        'human_handoff',
        { notification_id: notificationId },
        new Date().toISOString(),
      );

      await saveDialogueState(deps.db, {
        conversationId: input.conversation_id,
        tenantId: input.tenant_id,
        state: { ...interruptedState, last_turn_id: input.turn_id },
        turnId: input.turn_id,
      });
    }

    return await respondNode(
      state,
      commands,
      { ...flowResult, state: flowResult.state },
      [],
      [],
      flowResult.newStage ?? ctx.currentStage,
      ctx,
      deps,
      metrics,
      'interrupted',
      notificationId ? { reason, notification_id: notificationId } : undefined,
    );
  }

  // 4. Execute actions
  const { results, responseTexts, finalStage } = await executeActionsNode(
    state,
    flowResult,
    ctx,
    deps,
  );
  state.actionResults = results;

  // 5. Respond (persist + build response)
  return respondNode(
    state,
    commands,
    flowResult,
    results,
    responseTexts,
    finalStage,
    ctx,
    deps,
    metrics,
    input.dry_run ? 'dry_run' : 'completed',
  );
}
