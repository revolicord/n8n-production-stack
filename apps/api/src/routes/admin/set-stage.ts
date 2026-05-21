import { sql } from 'drizzle-orm';
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

/**
 * Etapas donde los follow-ups de la etapa anterior dejan de tener sentido.
 *
 * Cuando un lead cruza a cualquiera de estas, el `lead_cron` activo asociado
 * a su conversación se archiva con motivo 'stage_advanced'. Eso evita que el
 * followup-runner siga mandándole mensajes obsoletos (ej. "¿pudiste agendar?"
 * cuando ya reservó la llamada).
 *
 * NO incluye A→MS ni MS→B: en esas el flujo del agente sigue activo y los
 * follow-ups de la etapa destino sí aplican. El `Upsert Lead Cron` del
 * workflow agent-run se encarga de reprogramar el siguiente follow-up con
 * los delays de la nueva etapa.
 */
const STAGES_THAT_CANCEL_FOLLOWUPS: readonly Stage[] = ['C', 'D', 'disqualified'] as const;

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

      // ─────────────────────────────────────────────────────────────────────
      // Cancelar lead_crons activos cuando el lead avanza a una etapa donde
      // los follow-ups previos pierden sentido (C, D, disqualified).
      //
      // Esto resuelve el caso "el lead reservó en Calendly pero el cron sigue
      // mandándole '¿pudiste agendar?'" — al pasar a C/D, archivamos los
      // crons pendientes con motivo 'stage_advanced'.
      //
      // El UPDATE filtra por subscriber_id + tenant_id + is_active=TRUE.
      // No filtramos por conversation_id porque puede haber leads sin turn
      // activo (set-stage llamado por un webhook externo de Calendly más
      // adelante), y el modelo es "una conversación activa por subscriber".
      //
      // Es idempotente: si ya estaba archivado, no hace nada (filtro
      // is_active = TRUE).
      // ─────────────────────────────────────────────────────────────────────
      if (STAGES_THAT_CANCEL_FOLLOWUPS.includes(new_stage as Stage)) {
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
