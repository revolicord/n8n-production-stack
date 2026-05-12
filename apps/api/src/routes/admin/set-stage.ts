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

const SetStageBodySchema = z.object({
  new_stage: z.string().min(1),
  reason: z.string().optional(),
  evidence: z.string().optional(),
  turn_id: z.string().uuid().optional(),
});

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
        reason: reason ?? null,
        agentEvidence: evidence ?? null,
      });

      req.log.info(
        { subscriber_id: subscriberId, from: fromStage, to: new_stage },
        'lead stage updated',
      );

      return reply.code(200).send({ stage: new_stage, changed: true, from: fromStage });
    },
  );
}
