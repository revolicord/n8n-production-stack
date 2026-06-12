import { notifications } from '@dm-api/db';
import type { ActionResult } from '@dm-api/shared';
import { Queue } from 'bullmq';
import { z } from 'zod';
import type { ActionInvocation } from '../../core/flow-engine/engine.js';
import { emitDomainEvent } from '../events.js';
import type { ActionContext, ActionHandler } from '../registry.js';

const ConfigSchema = z.object({
  kind: z.enum(['audio', 'keyword', 'media', 'agent']).default('agent'),
  reason: z.string().min(1),
  summary: z.string().optional(),
});

export const notifyHumanHandler: ActionHandler = {
  type: 'notify_human',
  configSchema: ConfigSchema,

  async execute(invocation: ActionInvocation, ctx: ActionContext): Promise<ActionResult> {
    const config = ConfigSchema.safeParse(invocation.config);
    if (!config.success) {
      return {
        command_type: 'HumanHandoff',
        status: 'error',
        detail: { error: 'invalid config' },
        attempts: 0,
      };
    }

    if (ctx.dryRun) {
      return {
        command_type: 'HumanHandoff',
        status: 'dry_run',
        detail: { kind: config.data.kind, reason: config.data.reason },
        attempts: 0,
      };
    }

    const [row] = await ctx.db
      .insert(notifications)
      .values({
        tenantId: ctx.tenant.id,
        subscriberId: ctx.subscriber.id,
        conversationId: ctx.conversationId,
        turnId: ctx.turnId,
        kind: config.data.kind,
        source: 'agent',
        reason: config.data.reason,
        summary: config.data.summary,
        metadata: {},
      })
      .returning();

    if (!row) {
      throw new Error('notifications insert returned no row');
    }

    // Enqueue notify job for Telegram delivery
    const queue = new Queue<{ notificationId: string }>('notify', {
      connection: ctx.redis,
    });
    await queue.add('notify', { notificationId: row.id }, { jobId: `notif:${row.id}` });
    await queue.close();

    await emitDomainEvent(ctx.db, {
      tenantId: ctx.tenant.id,
      type: 'conversation.escalated',
      payload: { notification_id: row.id, kind: config.data.kind, reason: config.data.reason },
      turnId: ctx.turnId,
    });

    return {
      command_type: 'HumanHandoff',
      status: 'noted',
      detail: { notification_id: row.id, kind: config.data.kind },
      attempts: 1,
    };
  },
};
