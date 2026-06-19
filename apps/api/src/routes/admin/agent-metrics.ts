import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyAdminAuth } from '../../lib/admin-auth.js';
import { getDb } from '../../lib/db.js';
import { adminSecurity, doc, uuidParams } from '../../lib/openapi.js';
import { getAgentSavings } from '../../services/agent-metrics.js';

const UuidParamSchema = z.string().uuid();
const DaysSchema = z.coerce.number().int().min(1).max(365).default(30);

const DaysQuery = {
  type: 'object',
  properties: {
    days: { type: 'string', description: 'Ventana en días (1-365, default 30)' },
    mode: { type: 'string', enum: ['live', 'shadow', 'replay'], default: 'live' },
  },
} as const;

export default async function agentMetricsRoutes(app: FastifyInstance): Promise<void> {
  // GET /admin/tenants/:tenantId/agent-savings
  app.get<{ Params: { tenantId: string }; Querystring: { days?: string; mode?: string } }>(
    '/admin/tenants/:tenantId/agent-savings',
    doc({
      tags: ['admin/misc'],
      summary: 'Métrica de ahorro determinista del agente (CALM vs LLM-por-turno)',
      description:
        'Agrega agent_turn_traces por decision_path y devuelve cuántos turnos se ' +
        'resolvieron SIN LLM (fast_path + system), el % determinista y una ' +
        'estimación de tokens de input ahorrados frente a un agente que llama al ' +
        'LLM en cada turno.',
      security: adminSecurity,
      params: uuidParams('tenantId'),
      querystring: DaysQuery,
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
      const daysParsed = DaysSchema.safeParse(req.query.days ?? 30);
      if (!daysParsed.success) {
        return reply
          .code(400)
          .send({ error: { code: 'INVALID_PAYLOAD', details: daysParsed.error.issues } });
      }
      const mode = req.query.mode ?? 'live';
      const savings = await getAgentSavings(getDb(), {
        tenantId: paramParsed.data,
        days: daysParsed.data,
        mode,
      });
      req.log.info(
        {
          tenant_id: paramParsed.data,
          deterministic_pct: savings.deterministic_pct,
          total_turns: savings.total_turns,
        },
        'agent savings computed',
      );
      return reply.code(200).send(savings);
    },
  );
}
