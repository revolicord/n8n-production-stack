import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyAdminAuth } from '../../lib/admin-auth.js';
import { getDb } from '../../lib/db.js';
import {
  createFollowupTemplate,
  deactivateFollowupTemplate,
  getFollowupTemplateById,
  getFunnelStageById,
  listFollowupTemplatesByStage,
  listFunnelStages,
  listLeadFollowupHistory,
  updateFollowupTemplate,
} from '../../services/followups.js';
import { getSubscriberByUuid } from '../../services/subscribers.js';

const FollowupTypeEnum = z.enum(['text', 'flow', 'content']);

function isTypeConsistent(
  type: string,
  textTemplate: string | null | undefined,
  flowNs: string | null | undefined,
): boolean {
  if (type === 'text') return !!textTemplate;
  if (type === 'flow') return !!flowNs;
  if (type === 'content') return true; // mensajes viven en followup_messages
  return false;
}

export const CreateFollowupBodySchema = z
  .object({
    sequence_number: z.number().int().min(1),
    delay_minutes: z.number().int().positive(),
    type: FollowupTypeEnum,
    text_template: z.string().min(1).optional(),
    flow_ns: z.string().min(1).optional(),
    description: z.string().optional(),
  })
  .refine((d) => isTypeConsistent(d.type, d.text_template, d.flow_ns), {
    path: ['type'],
    message: 'text_template requerido si type=text; flow_ns requerido si type=flow',
  });

export const UpdateFollowupBodySchema = z.object({
  sequence_number: z.number().int().min(1).optional(),
  delay_minutes: z.number().int().positive().optional(),
  type: FollowupTypeEnum.optional(),
  text_template: z.string().min(1).nullable().optional(),
  flow_ns: z.string().min(1).nullable().optional(),
  description: z.string().nullable().optional(),
});

const UuidParamSchema = z.string().uuid();

function isDuplicateSequence(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === '23505'
  );
}

export default async function followupsRoutes(app: FastifyInstance): Promise<void> {
  // GET /admin/tenants/:tenantId/funnel-stages
  app.get<{ Params: { tenantId: string }; Querystring: { include_inactive?: string } }>(
    '/admin/tenants/:tenantId/funnel-stages',
    async (req, reply) => {
      if (!(await verifyAdminAuth(req, app))) {
        return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
      }
      const paramParsed = UuidParamSchema.safeParse(req.params.tenantId);
      if (!paramParsed.success) {
        return reply
          .code(400)
          .send({ error: { code: 'INVALID_PAYLOAD', details: paramParsed.error.issues } });
      }
      const includeInactive = req.query.include_inactive === 'true';
      const stages = await listFunnelStages(getDb(), {
        tenantId: paramParsed.data,
        includeInactive,
      });
      req.log.info({ tenant_id: paramParsed.data, count: stages.length }, 'funnel stages listed');
      return reply.code(200).send({ stages });
    },
  );

  // GET /admin/funnel-stages/:stageId/followups
  app.get<{ Params: { stageId: string }; Querystring: { include_inactive?: string } }>(
    '/admin/funnel-stages/:stageId/followups',
    async (req, reply) => {
      if (!(await verifyAdminAuth(req, app))) {
        return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
      }

      const paramParsed = UuidParamSchema.safeParse(req.params.stageId);
      if (!paramParsed.success) {
        return reply
          .code(400)
          .send({ error: { code: 'INVALID_PAYLOAD', details: paramParsed.error.issues } });
      }

      const stage = await getFunnelStageById(getDb(), paramParsed.data);
      if (!stage) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }

      const includeInactive = req.query.include_inactive === 'true';
      const followups = await listFollowupTemplatesByStage(getDb(), {
        stageId: stage.id,
        includeInactive,
      });

      req.log.info({ stage_id: stage.id, count: followups.length }, 'followup templates listed');
      return reply.code(200).send({ followups });
    },
  );

  // POST /admin/funnel-stages/:stageId/followups
  app.post<{ Params: { stageId: string } }>(
    '/admin/funnel-stages/:stageId/followups',
    async (req, reply) => {
      if (!(await verifyAdminAuth(req, app))) {
        return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
      }

      const paramParsed = UuidParamSchema.safeParse(req.params.stageId);
      if (!paramParsed.success) {
        return reply
          .code(400)
          .send({ error: { code: 'INVALID_PAYLOAD', details: paramParsed.error.issues } });
      }

      const stage = await getFunnelStageById(getDb(), paramParsed.data);
      if (!stage) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }

      const bodyParsed = CreateFollowupBodySchema.safeParse(req.body);
      if (!bodyParsed.success) {
        return reply
          .code(400)
          .send({ error: { code: 'INVALID_PAYLOAD', details: bodyParsed.error.issues } });
      }

      const { sequence_number, delay_minutes, type, text_template, flow_ns, description } =
        bodyParsed.data;

      try {
        const template = await createFollowupTemplate(getDb(), {
          stageId: stage.id,
          tenantId: stage.tenantId,
          sequenceNumber: sequence_number,
          delayMinutes: delay_minutes,
          type,
          textTemplate: text_template,
          flowNs: flow_ns,
          description,
        });

        req.log.info({ template_id: template.id, stage_id: stage.id }, 'followup template created');
        return reply.code(201).send(template);
      } catch (err) {
        if (isDuplicateSequence(err)) {
          return reply.code(409).send({ error: { code: 'DUPLICATE_SEQUENCE' } });
        }
        throw err;
      }
    },
  );

  // PUT /admin/followup-templates/:id
  app.put<{ Params: { id: string } }>('/admin/followup-templates/:id', async (req, reply) => {
    if (!(await verifyAdminAuth(req, app))) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
    }

    const paramParsed = UuidParamSchema.safeParse(req.params.id);
    if (!paramParsed.success) {
      return reply
        .code(400)
        .send({ error: { code: 'INVALID_PAYLOAD', details: paramParsed.error.issues } });
    }

    const existing = await getFollowupTemplateById(getDb(), paramParsed.data);
    if (!existing) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    }

    const bodyParsed = UpdateFollowupBodySchema.safeParse(req.body);
    if (!bodyParsed.success) {
      return reply
        .code(400)
        .send({ error: { code: 'INVALID_PAYLOAD', details: bodyParsed.error.issues } });
    }

    const patch = bodyParsed.data;

    // Merge con la fila existente y revalidar la invariante type/field
    const effectiveType = patch.type ?? existing.type;
    const effectiveText = 'text_template' in patch ? patch.text_template : existing.textTemplate;
    const effectiveFlow = 'flow_ns' in patch ? patch.flow_ns : existing.flowNs;

    if (!isTypeConsistent(effectiveType, effectiveText, effectiveFlow)) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_PAYLOAD',
          details: [
            {
              path: ['type'],
              message: 'text_template requerido si type=text; flow_ns requerido si type=flow',
            },
          ],
        },
      });
    }

    const drizzlePatch: Parameters<typeof updateFollowupTemplate>[2] = {};
    if (patch.sequence_number !== undefined) drizzlePatch.sequenceNumber = patch.sequence_number;
    if (patch.delay_minutes !== undefined) drizzlePatch.delayMinutes = patch.delay_minutes;
    if (patch.type !== undefined) drizzlePatch.type = patch.type;
    if ('text_template' in patch) drizzlePatch.textTemplate = patch.text_template ?? null;
    if ('flow_ns' in patch) drizzlePatch.flowNs = patch.flow_ns ?? null;
    if ('description' in patch) drizzlePatch.description = patch.description ?? null;

    try {
      const updated = await updateFollowupTemplate(getDb(), paramParsed.data, drizzlePatch);
      if (!updated) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }

      req.log.info({ template_id: updated.id }, 'followup template updated');
      return reply.code(200).send(updated);
    } catch (err) {
      if (isDuplicateSequence(err)) {
        return reply.code(409).send({ error: { code: 'DUPLICATE_SEQUENCE' } });
      }
      throw err;
    }
  });

  // DELETE /admin/followup-templates/:id
  app.delete<{ Params: { id: string } }>('/admin/followup-templates/:id', async (req, reply) => {
    if (!(await verifyAdminAuth(req, app))) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
    }

    const paramParsed = UuidParamSchema.safeParse(req.params.id);
    if (!paramParsed.success) {
      return reply
        .code(400)
        .send({ error: { code: 'INVALID_PAYLOAD', details: paramParsed.error.issues } });
    }

    const existing = await getFollowupTemplateById(getDb(), paramParsed.data);
    if (!existing) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    }

    await deactivateFollowupTemplate(getDb(), paramParsed.data);

    req.log.info({ template_id: paramParsed.data }, 'followup template deactivated');
    return reply.code(200).send({ id: paramParsed.data, isActive: false });
  });

  // GET /admin/leads/:subscriberId/followup-history
  app.get<{ Params: { subscriberId: string } }>(
    '/admin/leads/:subscriberId/followup-history',
    async (req, reply) => {
      if (!(await verifyAdminAuth(req, app))) {
        return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
      }

      const paramParsed = UuidParamSchema.safeParse(req.params.subscriberId);
      if (!paramParsed.success) {
        return reply
          .code(400)
          .send({ error: { code: 'INVALID_PAYLOAD', details: paramParsed.error.issues } });
      }

      const subscriber = await getSubscriberByUuid(getDb(), paramParsed.data);
      if (!subscriber) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }

      const history = await listLeadFollowupHistory(getDb(), {
        tenantId: subscriber.tenantId,
        subscriberId: subscriber.id,
      });

      req.log.info(
        { subscriber_id: subscriber.id, count: history.length },
        'followup history listed',
      );
      return reply.code(200).send({ history });
    },
  );
}
