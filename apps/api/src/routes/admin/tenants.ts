import { tenants } from '@dm-api/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { verifyAdminAuth } from '../../lib/admin-auth.js';
import { getDb } from '../../lib/db.js';

export default async function tenantsRoutes(app: FastifyInstance): Promise<void> {
  // GET /admin/tenants
  app.get('/admin/tenants', async (req, reply) => {
    if (!(await verifyAdminAuth(req, app))) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
    }
    const rows = await getDb()
      .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.isActive, true));
    return reply.code(200).send({ tenants: rows });
  });
}
