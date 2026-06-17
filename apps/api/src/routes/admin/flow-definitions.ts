import { FlowDefinitionSchema } from '@dm-api/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyAdminAuth } from '../../lib/admin-auth.js';
import { getDb } from '../../lib/db.js';
import { adminSecurity, doc, uuidParams, zodDoc } from '../../lib/openapi.js';
import {
  createFlowDefinition,
  deactivateFlowDefinition,
  getFlowDefinitionById,
  listFlowDefinitions,
  listStageFlowsForTenant,
} from '../../services/flow-definitions.js';

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
}
