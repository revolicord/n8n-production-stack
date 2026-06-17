import { tenants } from '@dm-api/db';
import { MediaPolicySchema } from '@dm-api/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyAdminAuth } from '../../lib/admin-auth.js';
import { getDb } from '../../lib/db.js';
import { adminSecurity, doc, uuidParams, zodDoc } from '../../lib/openapi.js';
import { updateTenantConfig } from '../../services/tenants.js';

// Subset editable de tenant.config vía dashboard (autoservicio de escalado + negocio).
const TenantConfigPatchSchema = z
  .object({
    notification_keywords: z.array(z.string()),
    media_policy: MediaPolicySchema,
    // ADR-0024: configuración de negocio editable en /settings/agente
    persona_prompt: z.string(),
    skeleton_prompt: z.string(),
    disqualification_reasons: z.array(z.string()),
    calendly_url: z.string().url().or(z.literal('')),
    nurturing_video_url: z.string().url().or(z.literal('')),
  })
  .partial();

export default async function tenantsRoutes(app: FastifyInstance): Promise<void> {
  // GET /admin/tenants
  app.get(
    '/admin/tenants',
    doc({
      tags: ['admin/misc'],
      summary: 'Listar tenants activos (id, slug, name)',
      security: adminSecurity,
    }),
    async (req, reply) => {
      if (!(await verifyAdminAuth(req, app))) {
        return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
      }
      const rows = await getDb()
        .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
        .from(tenants)
        .where(eq(tenants.isActive, true));
      return reply.code(200).send({ tenants: rows });
    },
  );

  // PATCH /admin/tenants/:id/config — merge del subset editable sobre tenant.config
  app.patch<{ Params: { id: string } }>(
    '/admin/tenants/:id/config',
    doc({
      tags: ['admin/misc'],
      summary: 'Actualizar config editable del tenant (escalado + negocio)',
      description:
        'Merge superficial sobre tenant.config: solo toca las claves enviadas, ' +
        'preserva el resto. Subset editable: notification_keywords, media_policy, ' +
        'persona_prompt, skeleton_prompt, disqualification_reasons, calendly_url, nurturing_video_url.',
      security: adminSecurity,
      params: uuidParams('id'),
      body: zodDoc(TenantConfigPatchSchema),
    }),
    async (req, reply) => {
      if (!(await verifyAdminAuth(req, app))) {
        return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
      }
      const parsed = TenantConfigPatchSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: { code: 'INVALID_PAYLOAD', details: parsed.error.issues },
        });
      }
      const updated = await updateTenantConfig(getDb(), {
        tenantId: req.params.id,
        patch: parsed.data,
      });
      if (!updated) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }
      req.log.info({ tenant_id: updated.id }, 'tenant config updated');
      return reply.code(200).send({ config: updated.config });
    },
  );
}
