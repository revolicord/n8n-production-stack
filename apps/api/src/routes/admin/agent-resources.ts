import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getConfig } from '../../config.js';
import { verifyBearerToken } from '../../lib/auth.js';
import { getDb } from '../../lib/db.js';
import {
  createAgentResource,
  deactivateAgentResource,
  getAgentResourceById,
  listAgentResources,
  updateAgentResource,
} from '../../services/agent-resources.js';

const UuidParamSchema = z.string().uuid();

const CategoryEnum = z.enum(['cierre', 'objecion', 'general']);

export const CreateAgentResourceBodySchema = z
  .object({
    category: CategoryEnum,
    slug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9_-]+$/),
    display_name: z.string().min(1).max(200),
    trigger_hint: z.string().max(500).optional(),
    text_content: z.string().optional(),
    media_url: z.string().url().optional(),
    sort_order: z.number().int().min(0).optional(),
  })
  .refine((d) => d.text_content !== undefined || d.media_url !== undefined, {
    message: 'Se requiere al menos text_content o media_url',
  });

export const UpdateAgentResourceBodySchema = z.object({
  category: CategoryEnum.optional(),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9_-]+$/)
    .optional(),
  display_name: z.string().min(1).max(200).optional(),
  trigger_hint: z.string().max(500).nullable().optional(),
  text_content: z.string().nullable().optional(),
  media_url: z.string().url().nullable().optional(),
  sort_order: z.number().int().min(0).optional(),
});

function isDuplicateSlug(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === '23505'
  );
}

export default async function agentResourcesRoutes(app: FastifyInstance): Promise<void> {
  const config = getConfig();

  function auth(authorization: string | undefined): boolean {
    return verifyBearerToken(authorization, config.N8N_CALLBACK_TOKEN);
  }

  // GET /admin/tenants/:tenantId/agent-resources
  app.get<{
    Params: { tenantId: string };
    Querystring: { category?: string };
  }>('/admin/tenants/:tenantId/agent-resources', async (req, reply) => {
    if (!auth(req.headers.authorization)) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
    }
    const paramParsed = UuidParamSchema.safeParse(req.params.tenantId);
    if (!paramParsed.success) {
      return reply
        .code(400)
        .send({ error: { code: 'INVALID_PAYLOAD', details: paramParsed.error.issues } });
    }
    const resources = await listAgentResources(getDb(), {
      tenantId: paramParsed.data,
      category: req.query.category,
    });
    req.log.info(
      { tenant_id: paramParsed.data, count: resources.length },
      'agent resources listed',
    );
    return reply.code(200).send({ resources });
  });

  // POST /admin/tenants/:tenantId/agent-resources
  app.post<{ Params: { tenantId: string } }>(
    '/admin/tenants/:tenantId/agent-resources',
    async (req, reply) => {
      if (!auth(req.headers.authorization)) {
        return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
      }
      const paramParsed = UuidParamSchema.safeParse(req.params.tenantId);
      if (!paramParsed.success) {
        return reply
          .code(400)
          .send({ error: { code: 'INVALID_PAYLOAD', details: paramParsed.error.issues } });
      }
      const bodyParsed = CreateAgentResourceBodySchema.safeParse(req.body);
      if (!bodyParsed.success) {
        return reply
          .code(400)
          .send({ error: { code: 'INVALID_PAYLOAD', details: bodyParsed.error.issues } });
      }
      const { category, slug, display_name, trigger_hint, text_content, media_url, sort_order } =
        bodyParsed.data;
      try {
        const resource = await createAgentResource(getDb(), {
          tenantId: paramParsed.data,
          category,
          slug,
          displayName: display_name,
          triggerHint: trigger_hint ?? null,
          textContent: text_content ?? null,
          mediaUrl: media_url ?? null,
          sortOrder: sort_order ?? 0,
        });
        req.log.info({ resource_id: resource.id }, 'agent resource created');
        return reply.code(201).send(resource);
      } catch (err) {
        if (isDuplicateSlug(err)) {
          return reply.code(409).send({ error: { code: 'DUPLICATE_SLUG' } });
        }
        throw err;
      }
    },
  );

  // PUT /admin/agent-resources/:id
  app.put<{ Params: { id: string } }>('/admin/agent-resources/:id', async (req, reply) => {
    if (!auth(req.headers.authorization)) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
    }
    const paramParsed = UuidParamSchema.safeParse(req.params.id);
    if (!paramParsed.success) {
      return reply
        .code(400)
        .send({ error: { code: 'INVALID_PAYLOAD', details: paramParsed.error.issues } });
    }
    const existing = await getAgentResourceById(getDb(), paramParsed.data);
    if (!existing) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    }
    const bodyParsed = UpdateAgentResourceBodySchema.safeParse(req.body);
    if (!bodyParsed.success) {
      return reply
        .code(400)
        .send({ error: { code: 'INVALID_PAYLOAD', details: bodyParsed.error.issues } });
    }
    const patch = bodyParsed.data;
    const drizzlePatch: Parameters<typeof updateAgentResource>[2] = {};
    if (patch.category !== undefined) drizzlePatch.category = patch.category;
    if (patch.slug !== undefined) drizzlePatch.slug = patch.slug;
    if (patch.display_name !== undefined) drizzlePatch.displayName = patch.display_name;
    if ('trigger_hint' in patch) drizzlePatch.triggerHint = patch.trigger_hint ?? null;
    if ('text_content' in patch) drizzlePatch.textContent = patch.text_content ?? null;
    if ('media_url' in patch) drizzlePatch.mediaUrl = patch.media_url ?? null;
    if (patch.sort_order !== undefined) drizzlePatch.sortOrder = patch.sort_order;

    try {
      const updated = await updateAgentResource(getDb(), paramParsed.data, drizzlePatch);
      if (!updated) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }
      req.log.info({ resource_id: updated.id }, 'agent resource updated');
      return reply.code(200).send(updated);
    } catch (err) {
      if (isDuplicateSlug(err)) {
        return reply.code(409).send({ error: { code: 'DUPLICATE_SLUG' } });
      }
      throw err;
    }
  });

  // DELETE /admin/agent-resources/:id  (soft delete)
  app.delete<{ Params: { id: string } }>('/admin/agent-resources/:id', async (req, reply) => {
    if (!auth(req.headers.authorization)) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
    }
    const paramParsed = UuidParamSchema.safeParse(req.params.id);
    if (!paramParsed.success) {
      return reply
        .code(400)
        .send({ error: { code: 'INVALID_PAYLOAD', details: paramParsed.error.issues } });
    }
    const existing = await getAgentResourceById(getDb(), paramParsed.data);
    if (!existing) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    }
    await deactivateAgentResource(getDb(), paramParsed.data);
    req.log.info({ resource_id: paramParsed.data }, 'agent resource deactivated');
    return reply.code(200).send({ id: paramParsed.data, isActive: false });
  });
}
