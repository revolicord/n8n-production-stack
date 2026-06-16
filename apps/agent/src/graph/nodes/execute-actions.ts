import type { ActionResult, TurnInput } from '@dm-api/shared';
import { changeStageHandler } from '../../actions/handlers/change-stage.js';
import { httpRequestHandler } from '../../actions/handlers/http-request.js';
import { notifyHumanHandler } from '../../actions/handlers/notify-human.js';
import { replyTextHandler } from '../../actions/handlers/reply-text.js';
import { scheduleFollowupHandler } from '../../actions/handlers/schedule-followup.js';
import { sendContentHandler } from '../../actions/handlers/send-content.js';
import { ActionRegistry } from '../../actions/registry.js';
import { createDryRunAdapter, createManyChatAdapter } from '../../channel/manychat.js';
import type { AssembledContext } from '../../core/context/assemble.js';
import type { FlowEngineResult } from '../../core/flow-engine/engine.js';
import type { Deps } from '../../deps.js';

function buildRegistry(): ActionRegistry {
  const registry = new ActionRegistry();
  registry.register(sendContentHandler);
  registry.register(replyTextHandler);
  registry.register(changeStageHandler);
  registry.register(notifyHumanHandler);
  registry.register(scheduleFollowupHandler);
  registry.register(httpRequestHandler);
  return registry;
}

const registry = buildRegistry();

export async function executeActionsNode(
  input: TurnInput,
  flowResult: FlowEngineResult,
  ctx: AssembledContext,
  deps: Deps,
): Promise<{ results: ActionResult[]; responseTexts: string[]; finalStage: string }> {
  const dryRun = input.dry_run;

  const apiKey = ctx.tenantConfig.manychat_api_key ?? '';
  const channel = dryRun || !apiKey ? createDryRunAdapter() : createManyChatAdapter(apiKey);

  const actionCtx = {
    tenant: ctx.tenant,
    tenantConfig: ctx.tenantConfig,
    subscriber: ctx.subscriber,
    conversationId: input.conversation_id,
    turnId: input.turn_id,
    channel,
    db: deps.db,
    redis: deps.redis,
    log: deps.logger,
    dryRun,
    stageCatalog: ctx.stageCatalog,
    currentStage: flowResult.newStage ?? ctx.currentStage,
  };

  const results: ActionResult[] = [];
  const responseTexts: string[] = [];
  let finalStage = flowResult.newStage ?? ctx.currentStage;

  for (const invocation of flowResult.invocations) {
    const handler = registry.get(invocation.action);
    if (!handler) {
      deps.logger.warn({ action: invocation.action }, 'no handler for action');
      results.push({
        command_type: invocation.action,
        status: 'skipped',
        detail: { reason: 'no_handler' },
        attempts: 0,
      });
      continue;
    }

    let result: ActionResult;
    try {
      result = await handler.execute(invocation, actionCtx);
    } catch (err) {
      deps.logger.error({ err, action: invocation.action }, 'action handler threw');
      result = {
        command_type: invocation.action,
        status: 'error',
        detail: { error: String(err) },
        attempts: 1,
      };

      if (invocation.on_failure === 'handoff') {
        // Trigger handoff on failure
        results.push(result);
        return {
          results,
          responseTexts,
          finalStage,
        };
      }
      if (invocation.on_failure === 'abort') {
        results.push(result);
        break;
      }
      // 'continue' — log and proceed
    }

    results.push(result);

    // Collect sent texts for response_texts
    if (
      (result.command_type === 'ReplyText' || result.command_type === 'reply_text') &&
      (result.status === 'sent' || result.status === 'dry_run')
    ) {
      const text = (result.detail as { text?: string }).text;
      if (text) responseTexts.push(text);
    }

    // Track stage changes
    if (
      (result.command_type === 'ChangeStage' || result.command_type === 'change_stage') &&
      result.status === 'changed'
    ) {
      const toStage = (result.detail as { to_stage?: string }).to_stage;
      if (toStage) finalStage = toStage;
    }

    // If action has save_as, update actionCtx current stage
    if (invocation.save_as && result.status === 'sent') {
      // The result will be available in next loop via re-running flow engine
      // For simplicity, we just continue
    }
  }

  deps.logger
    .child({ turn_id: input.turn_id, node: 'actions' })
    .info(
      { results: results.map((r) => ({ type: r.command_type, status: r.status })), finalStage },
      'actions executed',
    );

  return { results, responseTexts, finalStage };
}
