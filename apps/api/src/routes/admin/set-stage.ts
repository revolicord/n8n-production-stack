import { funnelStages, stageTransitionsMap } from '@dm-api/db';
import { sql } from 'drizzle-orm';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyAdminAuth } from '../../lib/admin-auth.js';
import { getDb } from '../../lib/db.js';
import { adminSecurity, doc, uuidParams, zodDoc } from '../../lib/openapi.js';
import {
  createStageTransition,
  getLeadStage,
  upsertLeadStage,
} from '../../services/lead-stages.js';
import { getSubscriberByUuid } from '../../services/subscribers.js';

const SetStageBodySchema = z.object({
  new_stage: z.string().min(1),
  reason: z.string().min(1),
  evidence: z.string().min(1),
  turn_id: z.string().uuid().optional(),
});

export default async function setStageRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { subscriberId: string } }>(
    '/admin/leads/:subscriberId/stage',
    doc({
      tags: ['admin/leads'],
      summary: 'Avanzar la etapa del funnel de un lead',
      description:
        'Transiciones válidas según stage_transitions_map del tenant. Si la etapa destino cancela follow-ups (C, D, disqualified) se archivan los lead_crons activos.',
      security: adminSecurity,
      params: uuidParams('subscriberId'),
      body: zodDoc(SetStageBodySchema),
    }),
    async (req, reply) => {
      if (!(await verifyAdminAuth(req, app))) {
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

      // Data-driven: validate against stage_transitions_map
      const allowedTransitions = await getDb()
        .select({ toStageSlug: stageTransitionsMap.toStageSlug })
        .from(stageTransitionsMap)
        .where(
          and(
            eq(stageTransitionsMap.tenantId, subscriber.tenantId),
            eq(stageTransitionsMap.fromStageSlug, fromStage),
            eq(stageTransitionsMap.isActive, true),
          ),
        );

      const allowed = allowedTransitions.map((t) => t.toStageSlug);

      // Fallback: if no data-driven transitions configured, allow anything (backwards compat)
      if (allowed.length > 0 && !allowed.includes(new_stage)) {
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

      // Data-driven: la etapa destino cancela follow-ups si está marcada is_terminal
      // en funnel_stages (reemplaza el Set hardcodeado ['C','D','disqualified']).
      const [destinationStage] = await getDb()
        .select({ isTerminal: funnelStages.isTerminal })
        .from(funnelStages)
        .where(
          and(eq(funnelStages.tenantId, subscriber.tenantId), eq(funnelStages.slug, new_stage)),
        )
        .limit(1);

      if (destinationStage?.isTerminal) {
        try {
          await getDb().execute(sql`
            UPDATE api.lead_crons
            SET is_active      = FALSE,
                archived_at    = NOW(),
                archive_reason = 'stage_advanced',
                updated_at     = NOW()
            WHERE tenant_id     = ${subscriber.tenantId}
              AND subscriber_id = ${subscriber.id}
              AND is_active     = TRUE
          `);

          req.log.info(
            { subscriber_id: subscriberId, new_stage },
            'lead_crons cancelled due to stage advance',
          );
        } catch (err) {
          // No queremos que un fallo cancelando lead_crons rompa el cambio
          // de etapa, que ya está commiteado arriba. Logueamos para auditar
          // pero respondemos éxito — el lead avanzó correctamente y los
          // follow-ups obsoletos los podemos limpiar manualmente si hace
          // falta. Si esto pasa más de una vez, hay que escalarlo a un job
          // de limpieza, no a un rollback del cambio de etapa.
          req.log.error(
            { err, subscriber_id: subscriberId, new_stage },
            'failed to cancel lead_crons after stage advance',
          );
        }
      }

      req.log.info(
        { subscriber_id: subscriberId, from: fromStage, to: new_stage },
        'lead stage updated',
      );

      return reply.code(200).send({ stage: new_stage, changed: true, from: fromStage });
    },
  );
}
