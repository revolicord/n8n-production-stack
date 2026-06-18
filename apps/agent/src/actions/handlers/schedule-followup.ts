import { leadCrons, leadStages } from '@dm-api/db';
import type { ActionResult } from '@dm-api/shared';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ActionInvocation } from '../../core/flow-engine/engine.js';
import type { ActionContext, ActionHandler } from '../registry.js';

const ConfigSchema = z.object({
  delay_minutes: z.number().int().positive(),
  note: z.string().optional(),
});

export const scheduleFollowupHandler: ActionHandler = {
  type: 'schedule_followup',
  configSchema: ConfigSchema,

  async execute(invocation: ActionInvocation, ctx: ActionContext): Promise<ActionResult> {
    const config = ConfigSchema.safeParse(invocation.config);
    if (!config.success) {
      return {
        command_type: 'ScheduleFollowup',
        status: 'error',
        detail: { error: 'invalid config' },
        attempts: 0,
      };
    }

    if (ctx.dryRun) {
      return {
        command_type: 'ScheduleFollowup',
        status: 'dry_run',
        detail: { delay_minutes: config.data.delay_minutes },
        attempts: 0,
      };
    }

    const nextFollowupAt = new Date(Date.now() + config.data.delay_minutes * 60 * 1000);

    const stageRows = await ctx.db
      .select({ currentStageId: leadStages.currentStageId })
      .from(leadStages)
      .where(
        and(eq(leadStages.tenantId, ctx.tenant.id), eq(leadStages.subscriberId, ctx.subscriber.id)),
      )
      .limit(1);

    const currentStageId = stageRows[0]?.currentStageId ?? null;

    await ctx.db
      .insert(leadCrons)
      .values({
        tenantId: ctx.tenant.id,
        subscriberId: ctx.subscriber.id,
        conversationId: ctx.conversationId,
        currentStageId,
        nextFollowupAt,
        nextSequenceNumber: 1,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: [leadCrons.tenantId, leadCrons.subscriberId, leadCrons.conversationId],
        set: {
          nextFollowupAt,
          // Re-programar reinicia la secuencia (re-engagement), igual que el upsert n8n.
          nextSequenceNumber: 1,
          isActive: true,
          archivedAt: null,
          archiveReason: null,
          updatedAt: sql`now()`,
        },
      });

    return {
      command_type: 'ScheduleFollowup',
      status: 'scheduled',
      detail: { next_at: nextFollowupAt.toISOString(), delay_minutes: config.data.delay_minutes },
      attempts: 1,
    };
  },
};
