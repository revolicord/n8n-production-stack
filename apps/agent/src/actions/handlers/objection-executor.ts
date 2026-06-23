import type {
  ActionResult,
  ObjectionAction,
  ObjectionDetectionResult,
  ObjectionResourceConfig,
} from '@dm-api/shared';
import { ObjectionResourceConfigSchema } from '@dm-api/shared';
import type { Logger } from 'pino';
import type { ActionContext } from '../registry.js';
import { applyStageTransition } from './change-stage.js';

export interface ObjectionResource {
  slug: string;
  displayName: string;
  triggerHint?: string | null;
  textContent?: string | null;
  mediaUrl?: string | null;
  config?: unknown;
}

export interface ObjectionExecutionResult {
  objectionId: string;
  responseTexts: string[];
  actionResults: ActionResult[];
}

/**
 * Ejecuta la respuesta configurada para una objeción detectada.
 * Usa el textContent del recurso como respuesta base y ejecuta las acciones en config.
 * Si la objeción no tiene recurso configurado, devuelve resultado vacío.
 */
export async function executeObjectionResponse(
  detection: ObjectionDetectionResult,
  resources: ObjectionResource[],
  ctx: ActionContext,
  log: Logger,
): Promise<ObjectionExecutionResult> {
  const resource = resources.find((r) => r.slug === detection.objection_id);

  if (!resource) {
    log.warn({ objection_id: detection.objection_id }, 'objection resource not found — skipping');
    return { objectionId: detection.objection_id, responseTexts: [], actionResults: [] };
  }

  const responseTexts: string[] = [];
  const actionResults: ActionResult[] = [];

  // 1. Enviar texto de respuesta del recurso si existe
  if (resource.textContent) {
    if (ctx.dryRun) {
      actionResults.push({
        command_type: 'ReplyText',
        status: 'dry_run',
        detail: { text: resource.textContent, source: 'objection_template' },
        attempts: 0,
      });
    } else {
      try {
        await ctx.channel.sendText(ctx.subscriber.manychatSubscriberId, resource.textContent);
        actionResults.push({
          command_type: 'ReplyText',
          status: 'sent',
          detail: { text: resource.textContent, source: 'objection_template' },
          attempts: 1,
        });
        responseTexts.push(resource.textContent);
      } catch (err) {
        log.error({ err, objection_id: detection.objection_id }, 'objection reply_text failed');
        actionResults.push({
          command_type: 'ReplyText',
          status: 'error',
          detail: { error: String(err) },
          attempts: 1,
        });
      }
    }
  }

  // 2. Ejecutar acciones configuradas en config.actions
  const configParsed = ObjectionResourceConfigSchema.safeParse(resource.config ?? {});
  if (!configParsed.success) {
    log.warn(
      { objection_id: detection.objection_id, issues: configParsed.error.issues },
      'invalid objection config — skipping actions',
    );
    return { objectionId: detection.objection_id, responseTexts, actionResults };
  }

  const config: ObjectionResourceConfig = configParsed.data;

  for (const action of config.actions ?? []) {
    try {
      const result = await executeObjectionAction(action, ctx, log);
      actionResults.push(result);
    } catch (err) {
      log.error(
        { err, action_type: action.type, objection_id: detection.objection_id },
        'objection action failed',
      );
      actionResults.push({
        command_type: action.type,
        status: 'error',
        detail: { error: String(err) },
        attempts: 1,
      });
    }
  }

  return { objectionId: detection.objection_id, responseTexts, actionResults };
}

async function executeObjectionAction(
  action: ObjectionAction,
  ctx: ActionContext,
  log: Logger,
): Promise<ActionResult> {
  switch (action.type) {
    case 'reply_text': {
      const { text } = action.params;
      if (ctx.dryRun) {
        return { command_type: 'ReplyText', status: 'dry_run', detail: { text }, attempts: 0 };
      }
      await ctx.channel.sendText(ctx.subscriber.manychatSubscriberId, text);
      return { command_type: 'ReplyText', status: 'sent', detail: { text }, attempts: 1 };
    }

    case 'send_flow': {
      const { flow_id } = action.params;
      if (ctx.dryRun) {
        return {
          command_type: 'SendContent',
          status: 'dry_run',
          detail: { flow_id },
          attempts: 0,
        };
      }
      // Find flow_ns from stageCatalog by slug_id
      const variant = ctx.stageCatalog.flatMap((s) => s.variants).find((v) => v.slugId === flow_id);

      if (!variant) {
        log.warn({ flow_id }, 'objection send_flow: flow_id not found in stageCatalog');
        return {
          command_type: 'SendContent',
          status: 'skipped',
          detail: { reason: 'flow_not_found', flow_id },
          attempts: 0,
        };
      }

      await ctx.channel.sendFlow(ctx.subscriber.manychatSubscriberId, variant.flowNs);
      return {
        command_type: 'SendContent',
        status: 'sent',
        detail: { flow_id, flow_ns: variant.flowNs },
        attempts: 1,
      };
    }

    case 'change_stage': {
      const { stage_id } = action.params;
      if (ctx.dryRun) {
        return {
          command_type: 'ChangeStage',
          status: 'dry_run',
          detail: { stage_id },
          attempts: 0,
        };
      }
      const result = await applyStageTransition(ctx, {
        toStage: stage_id,
        reason: 'objection',
        evidence: `objeción detectada: ${action.params.stage_id}`,
      });
      return {
        command_type: 'ChangeStage',
        status: result.changed ? 'changed' : 'skipped',
        detail: { from_stage: result.fromStage, to_stage: stage_id },
        attempts: 1,
      };
    }

    case 'add_tag': {
      const { tag } = action.params;
      // Tags se guardan en subscriber.metadata como array de strings
      // Por ahora se loguea y se marca como noted (no hay tabla de tags)
      log.info({ tag, subscriber_id: ctx.subscriber.id }, 'objection add_tag noted');
      return {
        command_type: 'AddTag',
        status: 'noted',
        detail: { tag },
        attempts: 0,
      };
    }
  }
}
