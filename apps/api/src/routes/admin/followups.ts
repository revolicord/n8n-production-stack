import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyAdminAuth } from '../../lib/admin-auth.js';
import { getDb } from '../../lib/db.js';
import { adminSecurity, doc, uuidParams, zodDoc } from '../../lib/openapi.js';
import {
  createFollowupTemplate,
  createFunnelStage,
  deactivateFollowupTemplate,
  deactivateFunnelStage,
  getFollowupTemplateById,
  getFunnelStageById,
  listFollowupTemplatesByStage,
  listFunnelStages,
  listLeadFollowupHistory,
  updateFollowupTemplate,
  updateFunnelStage,
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

const IncludeInactiveQuery = {
  type: 'object',
  properties: {
    include_inactive: { type: 'string', enum: ['true', 'false'], default: 'false' },
  },
} as const;

const StageSlugSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[a-z0-9_-]+$/i, 'slug solo admite letras, números, guion y guion bajo');

const CreateFunnelStageBodySchema = z.object({
  slug: StageSlugSchema,
  display_name: z.string().min(1).max(200),
  position: z.number().int().min(0),
  description: z.string().nullable().optional(),
  goal: z.string().nullable().optional(),
  max_followups: z.number().int().min(0).optional(),
  is_terminal: z.boolean().optional(),
});

const UpdateFunnelStageBodySchema = z.object({
  display_name: z.string().min(1).max(200).optional(),
  description: z.string().nullable().optional(),
  goal: z.string().nullable().optional(),
  position: z.number().int().min(0).optional(),
  max_followups: z.number().int().min(0).optional(),
  is_terminal: z.boolean().optional(),
  is_active: z.boolean().optional(),
  nurture_video_url: z.string().nullable().optional(),
  call_link: z.string().nullable().optional(),
});

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
    doc({
      tags: ['admin/followups'],
      summary: 'Listar etapas del funnel de un tenant',
      security: adminSecurity,
      params: uuidParams('tenantId'),
      querystring: IncludeInactiveQuery,
    }),
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
    doc({
      tags: ['admin/followups'],
      summary: 'Listar templates de follow-up de una etapa',
      security: adminSecurity,
      params: uuidParams('stageId'),
      querystring: IncludeInactiveQuery,
    }),
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
    doc({
      tags: ['admin/followups'],
      summary: 'Crear template de follow-up en una etapa',
      description:
        'type=text requiere text_template; type=flow requiere flow_ns; type=content usa followup_messages. ' +
        '409 DUPLICATE_SEQUENCE si ya existe ese sequence_number en la etapa.',
      security: adminSecurity,
      params: uuidParams('stageId'),
      body: zodDoc(CreateFollowupBodySchema),
    }),
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
  app.put<{ Params: { id: string } }>(
    '/admin/followup-templates/:id',
    doc({
      tags: ['admin/followups'],
      summary: 'Actualizar template de follow-up (parcial)',
      security: adminSecurity,
      params: uuidParams('id'),
      body: zodDoc(UpdateFollowupBodySchema),
    }),
    async (req, reply) => {
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
    },
  );

  // DELETE /admin/followup-templates/:id
  app.delete<{ Params: { id: string } }>(
    '/admin/followup-templates/:id',
    doc({
      tags: ['admin/followups'],
      summary: 'Desactivar template de follow-up (soft delete)',
      security: adminSecurity,
      params: uuidParams('id'),
    }),
    async (req, reply) => {
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
    },
  );

  // POST /admin/tenants/:tenantId/funnel-stages
  app.post<{ Params: { tenantId: string } }>(
    '/admin/tenants/:tenantId/funnel-stages',
    doc({
      tags: ['admin/followups'],
      summary: 'Crear etapa del funnel',
      description: '409 DUPLICATE_SLUG si el slug ya existe en el tenant.',
      security: adminSecurity,
      params: uuidParams('tenantId'),
      body: zodDoc(CreateFunnelStageBodySchema),
    }),
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

      const bodyParsed = CreateFunnelStageBodySchema.safeParse(req.body);
      if (!bodyParsed.success) {
        return reply
          .code(400)
          .send({ error: { code: 'INVALID_PAYLOAD', details: bodyParsed.error.issues } });
      }

      const { slug, display_name, position, description, goal, max_followups, is_terminal } =
        bodyParsed.data;

      try {
        const stage = await createFunnelStage(getDb(), {
          tenantId: paramParsed.data,
          slug,
          displayName: display_name,
          position,
          description,
          goal,
          maxFollowups: max_followups,
          isTerminal: is_terminal,
        });
        req.log.info({ stage_id: stage.id, tenant_id: paramParsed.data }, 'funnel stage created');
        return reply.code(201).send(stage);
      } catch (err) {
        if (isDuplicateSequence(err)) {
          return reply.code(409).send({ error: { code: 'DUPLICATE_SLUG' } });
        }
        throw err;
      }
    },
  );

  // PUT /admin/funnel-stages/:stageId
  app.put<{ Params: { stageId: string } }>(
    '/admin/funnel-stages/:stageId',
    doc({
      tags: ['admin/followups'],
      summary: 'Actualizar campos editables de una etapa del funnel',
      security: adminSecurity,
      params: uuidParams('stageId'),
      body: zodDoc(UpdateFunnelStageBodySchema),
    }),
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

      const bodyParsed = UpdateFunnelStageBodySchema.safeParse(req.body);
      if (!bodyParsed.success) {
        return reply
          .code(400)
          .send({ error: { code: 'INVALID_PAYLOAD', details: bodyParsed.error.issues } });
      }

      const patch = bodyParsed.data;
      const drizzlePatch: Parameters<typeof updateFunnelStage>[2] = {};
      if (patch.display_name !== undefined) drizzlePatch.displayName = patch.display_name;
      if ('description' in patch) drizzlePatch.description = patch.description ?? null;
      if ('goal' in patch) drizzlePatch.goal = patch.goal ?? null;
      if (patch.position !== undefined) drizzlePatch.position = patch.position;
      if (patch.max_followups !== undefined) drizzlePatch.maxFollowups = patch.max_followups;
      if (patch.is_terminal !== undefined) drizzlePatch.isTerminal = patch.is_terminal;
      if (patch.is_active !== undefined) drizzlePatch.isActive = patch.is_active;
      if ('nurture_video_url' in patch)
        drizzlePatch.nurtureVideoUrl = patch.nurture_video_url ?? null;
      if ('call_link' in patch) drizzlePatch.callLink = patch.call_link ?? null;

      const updated = await updateFunnelStage(getDb(), paramParsed.data, drizzlePatch);
      if (!updated) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }

      req.log.info({ stage_id: updated.id }, 'funnel stage updated');
      return reply.code(200).send(updated);
    },
  );

  // DELETE /admin/funnel-stages/:stageId  (soft delete)
  app.delete<{ Params: { stageId: string } }>(
    '/admin/funnel-stages/:stageId',
    doc({
      tags: ['admin/followups'],
      summary: 'Desactivar etapa del funnel (soft delete)',
      security: adminSecurity,
      params: uuidParams('stageId'),
    }),
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

      await deactivateFunnelStage(getDb(), paramParsed.data);
      req.log.info({ stage_id: paramParsed.data }, 'funnel stage deactivated');
      return reply.code(200).send({ id: paramParsed.data, isActive: false });
    },
  );

  // GET /admin/leads/:subscriberId/followup-history
  app.get<{ Params: { subscriberId: string } }>(
    '/admin/leads/:subscriberId/followup-history',
    doc({
      tags: ['admin/followups'],
      summary: 'Historial de follow-ups enviados a un lead',
      security: adminSecurity,
      params: uuidParams('subscriberId'),
    }),
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
