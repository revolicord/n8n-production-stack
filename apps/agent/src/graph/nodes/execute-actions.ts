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

  // ─── Política "camino feliz sin texto del LLM" (regla de negocio) ─────────
  // En etapas `flow_only`, si el turno ya entrega algo al lead vía flow (un
  // send_content, o un reply_text *scripted* con origin:'flow' como el link de
  // Calendly), descartamos el texto improvisado del LLM (ReplyText/Clarify con
  // origin:'command') para que NO salga pegado al flujo. Ante un desvío (el turno
  // no produjo salida de flow) el texto del LLM se conserva → nunca en visto.
  const stagePolicy =
    ctx.tenantConfig.text_policy_by_stage?.[ctx.currentStage] ??
    ctx.tenantConfig.text_policy_default ??
    'text_ok';

  const hasFlowOutbound = flowResult.invocations.some(
    (inv) =>
      inv.action === 'send_content' || (inv.action === 'reply_text' && inv.origin === 'flow'),
  );
  const suppressLlmText = stagePolicy === 'flow_only' && hasFlowOutbound;

  const invocations = suppressLlmText
    ? flowResult.invocations.filter(
        (inv) => !(inv.action === 'reply_text' && inv.origin === 'command'),
      )
    : flowResult.invocations;

  if (suppressLlmText && invocations.length < flowResult.invocations.length) {
    deps.logger
      .child({ turn_id: input.turn_id, node: 'actions' })
      .info(
        { stage: ctx.currentStage, suppressed: flowResult.invocations.length - invocations.length },
        'flow_only: texto improvisado del LLM suprimido (camino feliz)',
      );
  }

  for (const invocation of invocations) {
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

  // ─── Guardrail: nunca dejar al lead sin un mensaje visible ────────────────
  // Regla de negocio dura: si el turno no produjo NINGÚN mensaje que llegue al
  // lead (ni ReplyText/Clarify ni SendContent), enviamos algo de último recurso.
  // Evita el bug de "ChangeStage en silencio".
  const gotLeadMessage = () =>
    results.some(
      (r) =>
        (r.command_type === 'ReplyText' ||
          r.command_type === 'reply_text' ||
          r.command_type === 'SendContent' ||
          r.command_type === 'send_content') &&
        (r.status === 'sent' || r.status === 'dry_run'),
    );

  // Content-first: si el turno avanzó de etapa pero el cascade no entregó contenido,
  // intenta enviar el contenido de la etapa NUEVA antes de caer al texto genérico.
  // (No reenvía contenido de la etapa actual → evita bucles de re-envío.)
  if (!gotLeadMessage() && finalStage !== ctx.currentStage) {
    const stageCat = ctx.stageCatalog.find((s) => s.stageSlug === finalStage);
    const variant = stageCat?.variants.find((v) => v.slugId != null);
    const handler = registry.get('send_content');
    if (variant?.slugId && handler) {
      try {
        const result = await handler.execute(
          {
            action: 'send_content',
            config: {
              slug_id: variant.slugId,
              lookup_stage: finalStage,
              evidence: 'no-reply guardrail: contenido de la etapa',
            },
            on_failure: 'continue',
            origin: 'command',
          },
          { ...actionCtx, currentStage: finalStage },
        );
        result.detail = { ...result.detail, guardrail: 'no_reply_content' };
        results.push(result);
      } catch (err) {
        deps.logger.error({ err, turn_id: input.turn_id }, 'no-reply content guardrail failed');
      }
    }
  }

  if (!gotLeadMessage()) {
    const fallbackText =
      ctx.tenantConfig.no_reply_fallback_text ?? 'Dame un segundo y seguimos. ¿Sigues por ahí?';
    deps.logger
      .child({ turn_id: input.turn_id, node: 'actions' })
      .warn(
        { fallbackText, n_results: results.length, finalStage },
        'no outbound message produced — firing no-reply guardrail',
      );

    const handler = registry.get('reply_text');
    if (handler) {
      try {
        const result = await handler.execute(
          {
            action: 'reply_text',
            config: { text: fallbackText },
            on_failure: 'continue',
            origin: 'command',
          },
          actionCtx,
        );
        result.detail = { ...result.detail, guardrail: 'no_reply' };
        results.push(result);
        if (result.status === 'sent' || result.status === 'dry_run')
          responseTexts.push(fallbackText);
      } catch (err) {
        deps.logger.error({ err, turn_id: input.turn_id }, 'no-reply guardrail send failed');
      }
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
