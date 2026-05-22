import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyAdminAuth } from '../../lib/admin-auth.js';
import { getDb } from '../../lib/db.js';
import {
  createFollowupMessage,
  deleteFollowupMessage,
  getFollowupMessageById,
  listFollowupMessages,
  updateFollowupMessage,
} from '../../services/followup-messages.js';
import { getFollowupTemplateById } from '../../services/followups.js';

const UuidParam = z.string().uuid();

const MessageTypeEnum = z.enum(['text', 'image']);

const CreateMessageBodySchema = z
  .object({
    message_type: MessageTypeEnum,
    text_content: z.string().min(1).optional(),
    media_url: z.string().url().optional(),
    sort_order: z.number().int().min(0).optional(),
  })
  .refine(
    (d) => {
      if (d.message_type === 'text') return !!d.text_content;
      if (d.message_type === 'image') return !!d.media_url;
      return false;
    },
    {
      message:
        'text_content requerido si message_type=text; media_url requerido si message_type=image',
    },
  );

export const UpdateMessageBodySchema = z.object({
  message_type: MessageTypeEnum.optional(),
  text_content: z.string().min(1).nullable().optional(),
  media_url: z.string().url().nullable().optional(),
  sort_order: z.number().int().min(0).optional(),
});

function isMessageConsistent(
  messageType: string,
  textContent: string | null | undefined,
  mediaUrl: string | null | undefined,
): boolean {
  if (messageType === 'text') return !!textContent;
  if (messageType === 'image') return !!mediaUrl;
  return false;
}

function toResponse(msg: {
  id: string;
  templateId: string;
  tenantId: string;
  messageType: string;
  textContent: string | null;
  mediaUrl: string | null;
  sortOrder: number;
  createdAt: Date | null;
}) {
  return {
    id: msg.id,
    template_id: msg.templateId,
    tenant_id: msg.tenantId,
    message_type: msg.messageType,
    text_content: msg.textContent,
    media_url: msg.mediaUrl,
    sort_order: msg.sortOrder,
    created_at: msg.createdAt,
  };
}

export default async function followupMessagesRoutes(app: FastifyInstance): Promise<void> {
  // GET /admin/followup-templates/:templateId/messages
  app.get<{ Params: { templateId: string } }>(
    '/admin/followup-templates/:templateId/messages',
    async (req, reply) => {
      if (!(await verifyAdminAuth(req, app))) {
        return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
      }
      const { templateId } = req.params;
      if (!UuidParam.safeParse(templateId).success) {
        return reply
          .code(400)
          .send({ error: { code: 'BAD_REQUEST', message: 'templateId inválido' } });
      }
      const db = getDb();
      const messages = await listFollowupMessages(db, templateId);
      return reply.code(200).send(messages.map(toResponse));
    },
  );

  // POST /admin/followup-templates/:templateId/messages
  app.post<{ Params: { templateId: string } }>(
    '/admin/followup-templates/:templateId/messages',
    async (req, reply) => {
      if (!(await verifyAdminAuth(req, app))) {
        return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
      }
      const { templateId } = req.params;
      if (!UuidParam.safeParse(templateId).success) {
        return reply
          .code(400)
          .send({ error: { code: 'BAD_REQUEST', message: 'templateId inválido' } });
      }
      const db = getDb();
      const template = await getFollowupTemplateById(db, templateId);
      if (!template) {
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: 'template no encontrado' } });
      }
      const bodyParsed = CreateMessageBodySchema.safeParse(req.body);
      if (!bodyParsed.success) {
        return reply
          .code(400)
          .send({ error: { code: 'BAD_REQUEST', issues: bodyParsed.error.issues } });
      }
      const body = bodyParsed.data;
      const msg = await createFollowupMessage(db, {
        templateId,
        tenantId: template.tenantId,
        messageType: body.message_type,
        textContent: body.text_content ?? null,
        mediaUrl: body.media_url ?? null,
        sortOrder: body.sort_order ?? 0,
      });
      return reply.code(201).send(toResponse(msg));
    },
  );

  // PUT /admin/followup-messages/:id
  app.put<{ Params: { id: string } }>('/admin/followup-messages/:id', async (req, reply) => {
    if (!(await verifyAdminAuth(req, app))) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
    }
    const { id } = req.params;
    if (!UuidParam.safeParse(id).success) {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'id inválido' } });
    }
    const bodyParsed = UpdateMessageBodySchema.safeParse(req.body);
    if (!bodyParsed.success) {
      return reply
        .code(400)
        .send({ error: { code: 'BAD_REQUEST', issues: bodyParsed.error.issues } });
    }
    const body = bodyParsed.data;
    const db = getDb();

    const existing = await getFollowupMessageById(db, id);
    if (!existing) {
      return reply
        .code(404)
        .send({ error: { code: 'NOT_FOUND', message: 'mensaje no encontrado' } });
    }

    // Merge con la fila existente y revalidar invariante type/field
    const effectiveType = body.message_type ?? existing.messageType;
    const effectiveText = 'text_content' in body ? body.text_content : existing.textContent;
    const effectiveMedia = 'media_url' in body ? body.media_url : existing.mediaUrl;

    if (!isMessageConsistent(effectiveType, effectiveText, effectiveMedia)) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_PAYLOAD',
          message:
            'text_content requerido si message_type=text; media_url requerido si message_type=image',
        },
      });
    }

    const patch: Parameters<typeof updateFollowupMessage>[2] = {};
    if (body.message_type !== undefined) patch.messageType = body.message_type;
    if (body.text_content !== undefined) patch.textContent = body.text_content;
    if (body.media_url !== undefined) patch.mediaUrl = body.media_url;
    if (body.sort_order !== undefined) patch.sortOrder = body.sort_order;

    const updated = await updateFollowupMessage(db, id, patch);
    if (!updated) {
      return reply
        .code(404)
        .send({ error: { code: 'NOT_FOUND', message: 'mensaje no encontrado' } });
    }
    return reply.code(200).send(toResponse(updated));
  });

  // DELETE /admin/followup-messages/:id
  app.delete<{ Params: { id: string } }>('/admin/followup-messages/:id', async (req, reply) => {
    if (!(await verifyAdminAuth(req, app))) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
    }
    const { id } = req.params;
    if (!UuidParam.safeParse(id).success) {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'id inválido' } });
    }
    const db = getDb();
    const existing = await getFollowupMessageById(db, id);
    if (!existing) {
      return reply
        .code(404)
        .send({ error: { code: 'NOT_FOUND', message: 'mensaje no encontrado' } });
    }
    await deleteFollowupMessage(db, id);
    return reply.code(204).send();
  });
}
