import { leadContentSent } from '@dm-api/db';
import type { ActionResult } from '@dm-api/shared';
import { z } from 'zod';
import type { ActionInvocation } from '../../core/flow-engine/engine.js';
import { emitDomainEvent } from '../events.js';
import type { ActionContext, ActionHandler } from '../registry.js';

const ConfigSchema = z.object({
  slug_id: z.string().min(1),
  evidence: z.string().optional(),
  lookup_stage: z.string().optional(),
});

export const sendContentHandler: ActionHandler = {
  type: 'send_content',
  configSchema: ConfigSchema,

  async execute(invocation: ActionInvocation, ctx: ActionContext): Promise<ActionResult> {
    const config = ConfigSchema.safeParse(invocation.config);
    if (!config.success) {
      return {
        command_type: 'SendContent',
        status: 'error',
        detail: { error: 'invalid config', issues: config.error.issues },
        attempts: 0,
      };
    }

    const { slug_id, lookup_stage } = config.data;
    const stageSlug = lookup_stage ?? ctx.currentStage;

    // Find the flowNs from stageCatalog
    const stageCat = ctx.stageCatalog.find((s) => s.stageSlug === stageSlug);
    const variant = stageCat?.variants.find((v) => v.slugId === slug_id);

    if (!variant) {
      return {
        command_type: 'SendContent',
        status: 'skipped',
        detail: { reason: 'slug_not_found', slug_id, stage: stageSlug },
        attempts: 0,
      };
    }

    if (ctx.dryRun) {
      return {
        command_type: 'SendContent',
        status: 'dry_run',
        detail: { flow_ns: variant.flowNs, slug_id, stage: stageSlug },
        attempts: 0,
      };
    }

    const result = await ctx.channel.sendFlow(variant.flowNs, ctx.subscriber.manychatSubscriberId);

    if (result.success) {
      // Record in lead_content_sent
      try {
        await ctx.db.insert(leadContentSent).values({
          tenantId: ctx.tenant.id,
          subscriberId: ctx.subscriber.id,
          conversationId: ctx.conversationId,
          stageSlug,
          slugId: slug_id,
          flowNs: variant.flowNs,
          turnId: ctx.turnId,
        });
      } catch {
        ctx.log.warn({ slug_id }, 'failed to record lead_content_sent');
      }

      await emitDomainEvent(ctx.db, {
        tenantId: ctx.tenant.id,
        type: 'content.sent',
        payload: { slug_id, flow_ns: variant.flowNs, stage: stageSlug },
        turnId: ctx.turnId,
      });
    }

    return {
      command_type: 'SendContent',
      status: result.success ? 'sent' : 'error',
      detail: { flow_ns: variant.flowNs, slug_id, attempts: result.attempts },
      attempts: result.attempts,
    };
  },
};
