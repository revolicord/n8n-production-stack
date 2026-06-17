import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyAdminAuth } from '../../lib/admin-auth.js';
import { getDb } from '../../lib/db.js';
import { adminSecurity, doc, uuidParams, zodDoc } from '../../lib/openapi.js';
import {
  createStageTransition,
  deactivateStageTransition,
  getStageTransitionById,
  listStageTransitions,
  updateStageTransition,
} from '../../services/stage-transitions-map.js';

const UuidParamSchema = z.string().uuid();

const StageSlugSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[a-z0-9_-]+$/i, 'slug solo admite letras, números, guion y guion bajo');

const IncludeInactiveQuery = {
  type: 'object',
  properties: {
    include_inactive: { type: 'string', enum: ['true', 'false'], default: 'false' },
  },
} as const;

export const CreateStageTransitionBodySchema = z.object({
  from_stage_slug: StageSlugSchema,
  to_stage_slug: StageSlugSchema,
  when_to_use: z.string().min(1).max(2000),
});

export const UpdateStageTransitionBodySchema = z.object({
  when_to_use: z.string().min(1).max(2000).optional(),
  is_active: z.boolean().optional(),
});

function isDuplicateFromTo(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === '23505'
  );
}

export default async function stageTransitionsMapRoutes(app: FastifyInstance): Promise<void> {
  // GET /admin/tenants/:tenantId/stage-transitions
  app.get<{ Params: { tenantId: string }; Querystring: { include_inactive?: string } }>(
    '/admin/tenants/:tenantId/stage-transitions',
    doc({
      tags: ['admin/stage-transitions'],
      summary: 'Listar reglas de transición de etapa de un tenant',
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
      const transitions = await listStageTransitions(getDb(), {
        tenantId: paramParsed.data,
        includeInactive,
      });
      req.log.info(
        { tenant_id: paramParsed.data, count: transitions.length },
        'stage transitions listed',
      );
      return reply.code(200).send({ transitions });
    },
  );

  // POST /admin/tenants/:tenantId/stage-transitions
  app.post<{ Params: { tenantId: string } }>(
    '/admin/tenants/:tenantId/stage-transitions',
    doc({
      tags: ['admin/stage-transitions'],
      summary: 'Crear regla de transición de etapa',
      description:
        'when_to_use es la instrucción de routing que lee el LLM. ' +
        '409 DUPLICATE_FROM_TO si ya existe esa pareja (from, to) en el tenant.',
      security: adminSecurity,
      params: uuidParams('tenantId'),
      body: zodDoc(CreateStageTransitionBodySchema),
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
      const bodyParsed = CreateStageTransitionBodySchema.safeParse(req.body);
      if (!bodyParsed.success) {
        return reply
          .code(400)
          .send({ error: { code: 'INVALID_PAYLOAD', details: bodyParsed.error.issues } });
      }
      const { from_stage_slug, to_stage_slug, when_to_use } = bodyParsed.data;
      try {
        const transition = await createStageTransition(getDb(), {
          tenantId: paramParsed.data,
          fromStageSlug: from_stage_slug,
          toStageSlug: to_stage_slug,
          whenToUse: when_to_use,
        });
        req.log.info({ transition_id: transition.id }, 'stage transition created');
        return reply.code(201).send(transition);
      } catch (err) {
        if (isDuplicateFromTo(err)) {
          return reply.code(409).send({ error: { code: 'DUPLICATE_FROM_TO' } });
        }
        throw err;
      }
    },
  );

  // PUT /admin/stage-transitions/:id
  app.put<{ Params: { id: string } }>(
    '/admin/stage-transitions/:id',
    doc({
      tags: ['admin/stage-transitions'],
      summary: 'Actualizar regla de transición (parcial)',
      security: adminSecurity,
      params: uuidParams('id'),
      body: zodDoc(UpdateStageTransitionBodySchema),
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
      const existing = await getStageTransitionById(getDb(), paramParsed.data);
      if (!existing) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }
      const bodyParsed = UpdateStageTransitionBodySchema.safeParse(req.body);
      if (!bodyParsed.success) {
        return reply
          .code(400)
          .send({ error: { code: 'INVALID_PAYLOAD', details: bodyParsed.error.issues } });
      }
      const patch = bodyParsed.data;
      const drizzlePatch: Parameters<typeof updateStageTransition>[2] = {};
      if (patch.when_to_use !== undefined) drizzlePatch.whenToUse = patch.when_to_use;
      if (patch.is_active !== undefined) drizzlePatch.isActive = patch.is_active;

      const updated = await updateStageTransition(getDb(), paramParsed.data, drizzlePatch);
      if (!updated) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }
      req.log.info({ transition_id: updated.id }, 'stage transition updated');
      return reply.code(200).send(updated);
    },
  );

  // DELETE /admin/stage-transitions/:id  (soft delete)
  app.delete<{ Params: { id: string } }>(
    '/admin/stage-transitions/:id',
    doc({
      tags: ['admin/stage-transitions'],
      summary: 'Desactivar regla de transición (soft delete)',
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
      const existing = await getStageTransitionById(getDb(), paramParsed.data);
      if (!existing) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }
      await deactivateStageTransition(getDb(), paramParsed.data);
      req.log.info({ transition_id: paramParsed.data }, 'stage transition deactivated');
      return reply.code(200).send({ id: paramParsed.data, isActive: false });
    },
  );
}
