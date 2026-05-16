import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getConfig } from '../../config.js';
import { verifyBearerToken } from '../../lib/auth.js';
import { getDb } from '../../lib/db.js';
import {
  createStageTransition,
  getLeadStage,
  upsertLeadStage,
} from '../../services/lead-stages.js';
import { getSubscriberByUuid } from '../../services/subscribers.js';

const STAGE = ['A', 'MS', 'B', 'C', 'D', 'disqualified'] as const;
type Stage = (typeof STAGE)[number];

const DISQUALIFIED_REASONS = [
  'no_money',
  'not_interested',
  'geographic',
  'no_quality',
  'fake_account',
] as const;

const VALID_TRANSITIONS: Record<Stage, readonly Stage[]> = {
  A: ['MS', 'disqualified'],
  MS: ['B', 'disqualified'],
  B: ['C', 'disqualified'],
  C: ['D', 'disqualified'],
  D: [],
  disqualified: [],
};

const SetStageBodySchema = z
  .object({
    new_stage: z.enum(STAGE),
    reason: z.string().min(1),
    evidence: z.string().min(1),
    turn_id: z.string().uuid().optional(),
  })
  .refine(
    (data) =>
      data.new_stage !== 'disqualified' ||
      (DISQUALIFIED_REASONS as readonly string[]).includes(data.reason),
    {
      path: ['reason'],
      message: `When new_stage is 'disqualified', reason must be one of: ${DISQUALIFIED_REASONS.join(', ')}`,
    },
  );

export default async function setStageRoute(app: FastifyInstance): Promise<void> {
  const config = getConfig();

  app.post<{ Params: { subscriberId: string } }>(
    '/admin/leads/:subscriberId/stage',
    async (req, reply) => {
      if (!verifyBearerToken(req.headers.authorization, config.N8N_CALLBACK_TOKEN)) {
        return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
      }

      const parsed = SetStageBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: { code: 'INVALID_PAYLOAD', details: parsed.error.issues },
        });
      }

      const { subscriberId } = req.params;
      const { new_stage, reason, evidence, turn_id } = parsed.data;

      const subscriber = await getSubscriberByUuid(getDb(), subscriberId);
      if (!subscriber) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }

      const fromStage = await getLeadStage(getDb(), {
        tenantId: subscriber.tenantId,
        subscriberId: subscriber.id,
      });

      if (fromStage === new_stage) {
        return reply.code(200).send({ stage: new_stage, changed: false });
      }

      const allowed = VALID_TRANSITIONS[fromStage as Stage] ?? [];
      if (!allowed.includes(new_stage)) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_TRANSITION',
            message: `Transition ${fromStage} → ${new_stage} is not allowed`,
            allowed,
          },
        });
      }

      await upsertLeadStage(getDb(), {
        tenantId: subscriber.tenantId,
        subscriberId: subscriber.id,
        stage: new_stage,
      });

      await createStageTransition(getDb(), {
        tenantId: subscriber.tenantId,
        subscriberId: subscriber.id,
        turnId: turn_id ?? null,
        fromStage,
        toStage: new_stage,
        reason,
        agentEvidence: evidence,
      });

      req.log.info(
        { subscriber_id: subscriberId, from: fromStage, to: new_stage },
        'lead stage updated',
      );

      return reply.code(200).send({ stage: new_stage, changed: true, from: fromStage });
    },
  );
}
