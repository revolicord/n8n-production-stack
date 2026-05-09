import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getDb } from '../lib/db.js';
import { getRedis } from '../lib/redis.js';

export default async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/healthz', async () => ({ status: 'ok', uptime: process.uptime() }));

  app.get('/readyz', async (_req, reply) => {
    const checks: Record<string, 'ok' | string> = {};
    try {
      await getDb().execute(sql`select 1`);
      checks.postgres = 'ok';
    } catch (err) {
      checks.postgres = err instanceof Error ? err.message : String(err);
    }
    try {
      const pong = await getRedis().ping();
      checks.redis = pong === 'PONG' ? 'ok' : `unexpected: ${pong}`;
    } catch (err) {
      checks.redis = err instanceof Error ? err.message : String(err);
    }

    const healthy = Object.values(checks).every((v) => v === 'ok');
    return reply.code(healthy ? 200 : 503).send({ status: healthy ? 'ready' : 'degraded', checks });
  });
}
