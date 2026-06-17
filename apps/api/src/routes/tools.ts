import type { FastifyInstance } from 'fastify';
import { getConfig } from '../config.js';
import { getDb } from '../lib/db.js';
import { adminSecurity, doc } from '../lib/openapi.js';
import { getRedis } from '../lib/redis.js';
import { fetchManyChatFlows, parseFlowName, syncFlowsToDb } from '../services/manychat-sync.js';
import { getTenantBySlug, parseTenantConfig } from '../services/tenants.js';

export interface TenantTool {
  name: string;
  description: string;
  flow_id: string;
  stage: string;
  media_type: string;
  variant_group: string;
  usage_condition: string | null;
}

export default async function toolsRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /tenants/:slug/tools ──────────────────────────────────────────────
  // Devuelve la lista de flows de ManyChat filtrados por prefijo del tenant.
  // Útil para explorar qué flows están disponibles.
  app.get<{ Params: { slug: string } }>(
    '/tenants/:slug/tools',
    doc({
      tags: ['tools'],
      summary: 'Flows de ManyChat del tenant parseados como tools',
      description:
        'Filtra los flows por prefijo (QC_ por defecto) y los parsea según la convención ' +
        'QC_{STAGE}_{MEDIA}_{DESC}[__{USAGE}][_vN]. Cache Redis de 5 min. Solo bearer N8N_CALLBACK_TOKEN.',
      security: adminSecurity,
      params: {
        type: 'object',
        properties: { slug: { type: 'string', examples: ['quantum-creators'] } },
        required: ['slug'],
      },
    }),
    async (req, reply) => {
      const config = getConfig();

      const auth = req.headers.authorization;
      if (auth !== `Bearer ${config.N8N_CALLBACK_TOKEN}`) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { slug } = req.params;
      const tenant = await getTenantBySlug(getDb(), slug);
      if (!tenant) return reply.code(404).send({ error: 'Tenant not found' });

      const tenantConfig = parseTenantConfig(tenant.config);
      const mcApiKey = tenantConfig.manychat_api_key;
      if (!mcApiKey) return reply.send({ tools: [] });

      const cacheKey = `mc:tools:${tenant.id}`;
      const cached = await getRedis().get(cacheKey);
      if (cached) {
        return reply.send({ tools: JSON.parse(cached) as TenantTool[] });
      }

      const mcFlows = await fetchManyChatFlows(mcApiKey, req.log);
      if (!mcFlows) return reply.send({ tools: [] });

      const flowPrefix = getFlowPrefix(tenantConfig);

      const tools: TenantTool[] = mcFlows
        .filter((f) => f.name.toUpperCase().startsWith(flowPrefix.toUpperCase()))
        .flatMap((f) => {
          const parsed = parseFlowName(f.name);
          if (!parsed) {
            req.log.warn({ name: f.name, slug }, 'flow name does not match convention — skipped');
            return [];
          }
          return [
            {
              name: f.name,
              description: `[${parsed.stage}/${parsed.mediaType}] ${parsed.contentDescription}${parsed.variant ? ` (${parsed.variant})` : ''}`,
              flow_id: f.ns,
              stage: parsed.stage,
              media_type: parsed.mediaType,
              variant_group: parsed.variantGroup,
              usage_condition: parsed.usageCondition,
            },
          ];
        });

      await getRedis().set(cacheKey, JSON.stringify(tools), 'EX', 300);
      req.log.info({ slug, tool_count: tools.length }, 'tools fetched from ManyChat');
      return reply.send({ tools });
    },
  );

  // ── POST /tenants/:slug/tools/sync ────────────────────────────────────────
  // Sincroniza flows de ManyChat → stage_flows en DB.
  // Por defecto escribe en pending_ns (requiere aprobación SQL manual).
  // ?force=true activa directamente — solo funciona en NODE_ENV != production.
  app.post<{
    Params: { slug: string };
    Querystring: { force?: string };
  }>(
    '/tenants/:slug/tools/sync',
    doc({
      tags: ['tools'],
      summary: 'Sincronizar flows ManyChat → stage_flows (DB)',
      description:
        'Por defecto escribe en pending_ns (requiere aprobación SQL manual). ?force=true activa directo, ' +
        'solo fuera de producción. Solo bearer N8N_CALLBACK_TOKEN.',
      security: adminSecurity,
      params: {
        type: 'object',
        properties: { slug: { type: 'string' } },
        required: ['slug'],
      },
      querystring: {
        type: 'object',
        properties: { force: { type: 'string', enum: ['true', 'false'] } },
      },
    }),
    async (req, reply) => {
      const config = getConfig();

      const auth = req.headers.authorization;
      if (auth !== `Bearer ${config.N8N_CALLBACK_TOKEN}`) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const isProduction = config.NODE_ENV === 'production';
      const force = req.query.force === 'true' && !isProduction;

      const { slug } = req.params;
      const tenant = await getTenantBySlug(getDb(), slug);
      if (!tenant) return reply.code(404).send({ error: 'Tenant not found' });

      const tenantConfig = parseTenantConfig(tenant.config);
      const mcApiKey = tenantConfig.manychat_api_key;
      if (!mcApiKey)
        return reply.code(400).send({ error: 'No manychat_api_key configured for tenant' });

      const mcFlows = await fetchManyChatFlows(mcApiKey, req.log);
      if (!mcFlows) return reply.code(502).send({ error: 'ManyChat API unavailable' });

      const flowPrefix = getFlowPrefix(tenantConfig);
      const db = getDb();

      const result = await syncFlowsToDb(db, tenant.id, mcFlows, flowPrefix, force, req.log);

      await getRedis().del(`mc:tools:${tenant.id}`);

      return reply.send({
        ...result,
        message: force
          ? 'Flows synced and activated directly (dev mode)'
          : 'Flows written to pending_ns. Approve in dashboard or run SQL to activate.',
      });
    },
  );
}

function getFlowPrefix(tenantConfig: ReturnType<typeof parseTenantConfig>): string {
  const cfg = tenantConfig as Record<string, unknown>;
  return typeof cfg.flow_prefix === 'string' ? cfg.flow_prefix : 'QC_';
}
