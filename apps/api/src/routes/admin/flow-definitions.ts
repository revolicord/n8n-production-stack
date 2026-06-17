import { FlowDefinitionSchema } from '@dm-api/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyAdminAuth } from '../../lib/admin-auth.js';
import { getDb } from '../../lib/db.js';
import { adminSecurity, doc, uuidParams, zodDoc } from '../../lib/openapi.js';
import {
  approveStageFlow,
  createFlowDefinition,
  createStageFlow,
  deactivateFlowDefinition,
  deleteStageFlow,
  getFlowDefinitionById,
  listFlowDefinitions,
  listStageFlowsForTenant,
  updateStageFlow,
} from '../../services/flow-definitions.js';
import { fetchManyChatFlows, syncFlowsToDb } from '../../services/manychat-sync.js';
import { getTenantById, parseTenantConfig } from '../../services/tenants.js';

const UuidParamSchema = z.string().uuid();

// El body de alta/edición es { definition: <FlowDefinition> }; se valida contra
// el contrato compartido antes de tocar la DB.
const WriteFlowDefinitionBodySchema = z.object({
  definition: FlowDefinitionSchema,
});

export default async function flowDefinitionsRoutes(app: FastifyInstance): Promise<void> {
  // GET /admin/tenants/:tenantId/flow-definitions
  app.get<{ Params: { tenantId: string } }>(
    '/admin/tenants/:tenantId/flow-definitions',
    doc({
      tags: ['admin/flow-definitions'],
      summary: 'Listar flows declarativos activos de un tenant',
      security: adminSecurity,
      params: uuidParams('tenantId'),
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
      const flows = await listFlowDefinitions(getDb(), paramParsed.data);
      req.log.info({ tenant_id: paramParsed.data, count: flows.length }, 'flow definitions listed');
      return reply.code(200).send({ flows });
    },
  );

  // GET /admin/tenants/:tenantId/stage-flows
  app.get<{ Params: { tenantId: string } }>(
    '/admin/tenants/:tenantId/stage-flows',
    doc({
      tags: ['admin/flow-definitions'],
      summary: 'Listar stage_flows activos (para el dropdown de send_content)',
      security: adminSecurity,
      params: uuidParams('tenantId'),
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
      const stageFlows = await listStageFlowsForTenant(getDb(), paramParsed.data);
      req.log.info({ tenant_id: paramParsed.data, count: stageFlows.length }, 'stage flows listed');
      return reply.code(200).send({ stage_flows: stageFlows });
    },
  );

  // POST /admin/tenants/:tenantId/flow-definitions
  app.post<{ Params: { tenantId: string } }>(
    '/admin/tenants/:tenantId/flow-definitions',
    doc({
      tags: ['admin/flow-definitions'],
      summary: 'Crear/publicar un flow declarativo (nueva versión activa)',
      description:
        'Valida definition contra FlowDefinitionSchema. Crea una versión nueva y ' +
        'desactiva la anterior del mismo flow_id en una transacción.',
      security: adminSecurity,
      params: uuidParams('tenantId'),
      body: zodDoc(WriteFlowDefinitionBodySchema),
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
      const bodyParsed = WriteFlowDefinitionBodySchema.safeParse(req.body);
      if (!bodyParsed.success) {
        return reply
          .code(400)
          .send({ error: { code: 'INVALID_PAYLOAD', details: bodyParsed.error.issues } });
      }
      const row = await createFlowDefinition(getDb(), {
        tenantId: paramParsed.data,
        definition: bodyParsed.data.definition,
      });
      req.log.info(
        { flow_definition_id: row.id, flow_id: row.flowId, version: row.version },
        'flow definition created',
      );
      return reply.code(201).send(row);
    },
  );

  // PUT /admin/flow-definitions/:id — edición = nueva versión del mismo flow_id
  app.put<{ Params: { id: string } }>(
    '/admin/flow-definitions/:id',
    doc({
      tags: ['admin/flow-definitions'],
      summary: 'Editar un flow declarativo (engendra nueva versión activa)',
      description:
        'definition.flow_id debe coincidir con el flow existente. Crea una versión ' +
        'nueva y desactiva la anterior en una transacción.',
      security: adminSecurity,
      params: uuidParams('id'),
      body: zodDoc(WriteFlowDefinitionBodySchema),
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
      const existing = await getFlowDefinitionById(getDb(), paramParsed.data);
      if (!existing) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }
      const bodyParsed = WriteFlowDefinitionBodySchema.safeParse(req.body);
      if (!bodyParsed.success) {
        return reply
          .code(400)
          .send({ error: { code: 'INVALID_PAYLOAD', details: bodyParsed.error.issues } });
      }
      if (bodyParsed.data.definition.flow_id !== existing.flowId) {
        return reply.code(400).send({
          error: {
            code: 'FLOW_ID_MISMATCH',
            message: `flow_id no se puede cambiar (esperado ${existing.flowId})`,
          },
        });
      }
      const row = await createFlowDefinition(getDb(), {
        tenantId: existing.tenantId,
        definition: bodyParsed.data.definition,
      });
      req.log.info(
        { flow_definition_id: row.id, flow_id: row.flowId, version: row.version },
        'flow definition updated',
      );
      return reply.code(200).send(row);
    },
  );

  // DELETE /admin/flow-definitions/:id  (desactiva)
  app.delete<{ Params: { id: string } }>(
    '/admin/flow-definitions/:id',
    doc({
      tags: ['admin/flow-definitions'],
      summary: 'Desactivar un flow declarativo',
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
      const existing = await getFlowDefinitionById(getDb(), paramParsed.data);
      if (!existing) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }
      await deactivateFlowDefinition(getDb(), paramParsed.data);
      req.log.info({ flow_definition_id: paramParsed.data }, 'flow definition deactivated');
      return reply.code(200).send({ id: paramParsed.data, active: false });
    },
  );

  // ─── stage-flows CRUD ────────────────────────────────────────────────────────

  const CreateStageFlowBodySchema = z.object({
    stage_id: z.string().uuid(),
    flow_ns: z.string().min(1),
    human_name: z.string().min(1),
    media_type: z.string().nullable().optional(),
    slug_id: z.string().nullable().optional(),
    content_description: z.string().nullable().optional(),
    usage_condition: z.string().nullable().optional(),
  });

  const UpdateStageFlowBodySchema = z.object({
    human_name: z.string().min(1).optional(),
    content_description: z.string().nullable().optional(),
    usage_condition: z.string().nullable().optional(),
    media_type: z.string().nullable().optional(),
    slug_id: z.string().nullable().optional(),
    is_active: z.boolean().optional(),
  });

  // POST /admin/tenants/:tenantId/stage-flows
  app.post<{ Params: { tenantId: string } }>(
    '/admin/tenants/:tenantId/stage-flows',
    doc({
      tags: ['admin/flow-definitions'],
      summary: 'Crear un stage_flow (flujo ManyChat disponible para el agente)',
      security: adminSecurity,
      params: uuidParams('tenantId'),
      body: zodDoc(CreateStageFlowBodySchema),
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
      const bodyParsed = CreateStageFlowBodySchema.safeParse(req.body);
      if (!bodyParsed.success) {
        return reply
          .code(400)
          .send({ error: { code: 'INVALID_PAYLOAD', details: bodyParsed.error.issues } });
      }
      const row = await createStageFlow(getDb(), {
        tenantId: paramParsed.data,
        stageId: bodyParsed.data.stage_id,
        flowNs: bodyParsed.data.flow_ns,
        humanName: bodyParsed.data.human_name,
        mediaType: bodyParsed.data.media_type ?? null,
        slugId: bodyParsed.data.slug_id ?? null,
        contentDescription: bodyParsed.data.content_description ?? null,
        usageCondition: bodyParsed.data.usage_condition ?? null,
      });
      req.log.info({ stage_flow_id: row.id, flow_ns: row.flowNs }, 'stage flow created');
      return reply.code(201).send(row);
    },
  );

  // PUT /admin/stage-flows/:id
  app.put<{ Params: { id: string } }>(
    '/admin/stage-flows/:id',
    doc({
      tags: ['admin/flow-definitions'],
      summary: 'Actualizar un stage_flow',
      security: adminSecurity,
      params: uuidParams('id'),
      body: zodDoc(UpdateStageFlowBodySchema),
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
      const bodyParsed = UpdateStageFlowBodySchema.safeParse(req.body);
      if (!bodyParsed.success) {
        return reply
          .code(400)
          .send({ error: { code: 'INVALID_PAYLOAD', details: bodyParsed.error.issues } });
      }
      const row = await updateStageFlow(getDb(), paramParsed.data, {
        humanName: bodyParsed.data.human_name,
        contentDescription: bodyParsed.data.content_description,
        usageCondition: bodyParsed.data.usage_condition,
        mediaType: bodyParsed.data.media_type,
        slugId: bodyParsed.data.slug_id,
        isActive: bodyParsed.data.is_active,
      });
      if (!row) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      req.log.info({ stage_flow_id: row.id }, 'stage flow updated');
      return reply.code(200).send(row);
    },
  );

  // POST /admin/tenants/:tenantId/stage-flows/sync — sync desde ManyChat API
  app.post<{ Params: { tenantId: string } }>(
    '/admin/tenants/:tenantId/stage-flows/sync',
    doc({
      tags: ['admin/flow-definitions'],
      summary: 'Sincronizar flows desde ManyChat → stage_flows (siempre en pending en prod)',
      security: adminSecurity,
      params: uuidParams('tenantId'),
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
      const tenant = await getTenantById(getDb(), paramParsed.data);
      if (!tenant) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

      const tenantConfig = parseTenantConfig(tenant.config);
      const mcApiKey = tenantConfig.manychat_api_key;
      if (!mcApiKey) {
        return reply.code(400).send({
          error: {
            code: 'NO_MANYCHAT_API_KEY',
            message: 'No hay manychat_api_key configurado para este tenant',
          },
        });
      }

      const mcFlows = await fetchManyChatFlows(mcApiKey, req.log);
      if (!mcFlows) {
        return reply.code(502).send({ error: { code: 'MANYCHAT_UNAVAILABLE' } });
      }

      const cfg = tenantConfig as Record<string, unknown>;
      const flowPrefix = typeof cfg.flow_prefix === 'string' ? cfg.flow_prefix : 'QC_';

      const result = await syncFlowsToDb(
        getDb(),
        paramParsed.data,
        mcFlows,
        flowPrefix,
        false,
        req.log,
      );
      req.log.info(
        {
          tenant_id: paramParsed.data,
          synced: result.synced.length,
          skipped: result.skipped.length,
        },
        'stage flows synced from ManyChat',
      );
      return reply.code(200).send(result);
    },
  );

  // POST /admin/stage-flows/:id/approve — activa un flow pendiente
  app.post<{ Params: { id: string } }>(
    '/admin/stage-flows/:id/approve',
    doc({
      tags: ['admin/flow-definitions'],
      summary: 'Aprobar un stage_flow pendiente (mueve pending_ns → flow_ns)',
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
      const row = await approveStageFlow(getDb(), paramParsed.data);
      if (!row) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      req.log.info({ stage_flow_id: row.id, flow_ns: row.flowNs }, 'stage flow approved');
      return reply.code(200).send(row);
    },
  );

  // DELETE /admin/stage-flows/:id
  app.delete<{ Params: { id: string } }>(
    '/admin/stage-flows/:id',
    doc({
      tags: ['admin/flow-definitions'],
      summary: 'Eliminar un stage_flow',
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
      const deleted = await deleteStageFlow(getDb(), paramParsed.data);
      if (!deleted) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      req.log.info({ stage_flow_id: paramParsed.data }, 'stage flow deleted');
      return reply.code(204).send();
    },
  );
}
