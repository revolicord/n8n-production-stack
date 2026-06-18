import { funnelStages, leadCrons, leadStages, stageTransitions } from '@dm-api/db';
import type { ActionResult } from '@dm-api/shared';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ActionInvocation } from '../../core/flow-engine/engine.js';
import { emitDomainEvent } from '../events.js';
import type { ActionContext, ActionHandler } from '../registry.js';

const ConfigSchema = z.object({
  to_stage: z.string().min(1),
  reason: z.string().nullable().optional(),
  evidence: z.string().min(1),
  lead_in: z.string().optional(),
  cascade: z.boolean().optional(),
});

export async function applyStageTransition(
  ctx: ActionContext,
  args: {
    toStage: string;
    reason: string | null | undefined;
    evidence: string;
  },
): Promise<{ fromStage: string; changed: boolean }> {
  const db = ctx.db;

  const currentRows = await db
    .select({ currentStage: leadStages.currentStage })
    .from(leadStages)
    .where(
      and(eq(leadStages.tenantId, ctx.tenant.id), eq(leadStages.subscriberId, ctx.subscriber.id)),
    )
    .limit(1);

  const fromStage = currentRows[0]?.currentStage ?? 'A';

  if (fromStage === args.toStage) {
    return { fromStage, changed: false };
  }

  await db
    .insert(leadStages)
    .values({
      tenantId: ctx.tenant.id,
      subscriberId: ctx.subscriber.id,
      currentStage: args.toStage,
      updatedAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: [leadStages.tenantId, leadStages.subscriberId],
      set: { currentStage: args.toStage, updatedAt: sql`now()` },
    });

  await db.insert(stageTransitions).values({
    tenantId: ctx.tenant.id,
    subscriberId: ctx.subscriber.id,
    turnId: ctx.turnId,
    fromStage,
    toStage: args.toStage,
    reason: args.reason ?? null,
    agentEvidence: args.evidence,
  });

  // Etapa terminal → cancelar follow-ups activos. Data-driven (funnel_stages.is_terminal,
  // editable por tenant en /settings), no una lista hardcodeada.
  const [destStage] = await db
    .select({ isTerminal: funnelStages.isTerminal })
    .from(funnelStages)
    .where(and(eq(funnelStages.tenantId, ctx.tenant.id), eq(funnelStages.slug, args.toStage)))
    .limit(1);

  if (destStage?.isTerminal) {
    await db
      .update(leadCrons)
      .set({
        isActive: false,
        archivedAt: sql`now()`,
        archiveReason: 'stage_advanced',
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(leadCrons.tenantId, ctx.tenant.id),
          eq(leadCrons.subscriberId, ctx.subscriber.id),
          eq(leadCrons.isActive, true),
        ),
      );
  }

  return { fromStage, changed: true };
}

export const changeStageHandler: ActionHandler = {
  type: 'change_stage',
  configSchema: ConfigSchema,

  async execute(invocation: ActionInvocation, ctx: ActionContext): Promise<ActionResult> {
    const config = ConfigSchema.safeParse(invocation.config);
    if (!config.success) {
      return {
        command_type: 'ChangeStage',
        status: 'error',
        detail: { error: 'invalid config' },
        attempts: 0,
      };
    }

    const { to_stage, reason, evidence } = config.data;

    if (ctx.dryRun) {
      return {
        command_type: 'ChangeStage',
        status: 'dry_run',
        detail: { to_stage, reason },
        attempts: 0,
      };
    }

    const { fromStage, changed } = await applyStageTransition(ctx, {
      toStage: to_stage,
      reason,
      evidence,
    });

    if (changed) {
      const eventType = to_stage === 'disqualified' ? 'lead.disqualified' : 'lead.stage_changed';
      await emitDomainEvent(ctx.db, {
        tenantId: ctx.tenant.id,
        type: eventType,
        payload: { from_stage: fromStage, to_stage, reason, evidence },
        turnId: ctx.turnId,
      });
    }

    return {
      command_type: 'ChangeStage',
      status: changed ? 'changed' : 'skipped',
      detail: { from_stage: fromStage, to_stage, changed },
      attempts: 1,
    };
  },
};
