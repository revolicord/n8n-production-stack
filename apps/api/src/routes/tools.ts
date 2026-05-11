import type { FastifyInstance } from 'fastify';
import { getConfig } from '../config.js';
import { getDb } from '../lib/db.js';
import { getRedis } from '../lib/redis.js';
import { getTenantBySlug, parseTenantConfig } from '../services/tenants.js';

interface ManyChatFlow {
  ns: string;
  name: string;
}

interface ManyChatFlowsResponse {
  status: string;
  data: { flows: ManyChatFlow[] };
}

export interface TenantTool {
  name: string;
  description: string;
  flow_id: string;
}

export default async function toolsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { slug: string } }>('/tenants/:slug/tools', async (req, reply) => {
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

    const res = await fetch('https://api.manychat.com/fb/page/getFlows', {
      headers: { Authorization: `Bearer ${mcApiKey}` },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      req.log.error({ status: res.status, slug }, 'ManyChat flows fetch failed');
      return reply.send({ tools: [] });
    }

    const data = (await res.json()) as ManyChatFlowsResponse;
    if (data.status !== 'success') return reply.send({ tools: [] });

    const tools: TenantTool[] = data.data.flows
      .filter((f) => f.name.toLowerCase().startsWith('bot_'))
      .map((f) => ({
        name: f.name,
        description: f.name.replace(/^bot_/i, '').trim(),
        flow_id: f.ns,
      }));

    await getRedis().set(cacheKey, JSON.stringify(tools), 'EX', 300);

    req.log.info({ slug, tool_count: tools.length }, 'tools fetched from ManyChat');
    return reply.send({ tools });
  });
}
