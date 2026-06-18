import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyAdminAuth } from '../../lib/admin-auth.js';
import { getDb } from '../../lib/db.js';
import { adminSecurity, doc, uuidParams, zodDoc } from '../../lib/openapi.js';
import {
  createBookingReminderTemplate,
  deleteBookingReminderTemplate,
  getBookingReminderTemplateById,
  listBookingReminderTemplates,
  updateBookingReminderTemplate,
} from '../../services/bookings.js';

const UuidParamSchema = z.string().uuid();

const ReminderTypeEnum = z.enum(['text', 'flow']);
const ReminderKindEnum = z.enum(['reminder', 'no_show']);

function isTypeConsistent(
  type: string,
  textTemplate: string | null | undefined,
  flowNs: string | null | undefined,
): boolean {
  if (type === 'text') return !!textTemplate;
  if (type === 'flow') return !!flowNs;
  return false;
}

export const CreateBookingReminderBodySchema = z
  .object({
    offset_minutes: z.number().int(),
    kind: ReminderKindEnum.optional(),
    type: ReminderTypeEnum,
    text_template: z.string().min(1).optional(),
    flow_ns: z.string().min(1).optional(),
    description: z.string().optional(),
    sort_order: z.number().int().min(0).optional(),
  })
  .refine((d) => isTypeConsistent(d.type, d.text_template, d.flow_ns), {
    path: ['type'],
    message: 'text_template requerido si type=text; flow_ns requerido si type=flow',
  });

export const UpdateBookingReminderBodySchema = z.object({
  offset_minutes: z.number().int().optional(),
  kind: ReminderKindEnum.optional(),
  type: ReminderTypeEnum.optional(),
  text_template: z.string().min(1).nullable().optional(),
  flow_ns: z.string().min(1).nullable().optional(),
  description: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().min(0).optional(),
});

export default async function bookingRemindersRoutes(app: FastifyInstance): Promise<void> {
  // GET /admin/tenants/:tenantId/booking-reminders
  app.get<{ Params: { tenantId: string } }>(
    '/admin/tenants/:tenantId/booking-reminders',
    doc({
      tags: ['admin/followups'],
      summary: 'Listar recordatorios de cita de un tenant',
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
      const reminders = await listBookingReminderTemplates(getDb(), paramParsed.data);
      return reply.code(200).send({ reminders });
    },
  );

  // POST /admin/tenants/:tenantId/booking-reminders
  app.post<{ Params: { tenantId: string } }>(
    '/admin/tenants/:tenantId/booking-reminders',
    doc({
      tags: ['admin/followups'],
      summary: 'Crear recordatorio de cita',
      description:
        'offset_minutes con signo: negativo = antes de la cita, positivo = después. ' +
        'kind=no_show para seguimiento si el lead no asiste.',
      security: adminSecurity,
      params: uuidParams('tenantId'),
      body: zodDoc(CreateBookingReminderBodySchema),
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
      const bodyParsed = CreateBookingReminderBodySchema.safeParse(req.body);
      if (!bodyParsed.success) {
        return reply
          .code(400)
          .send({ error: { code: 'INVALID_PAYLOAD', details: bodyParsed.error.issues } });
      }
      const b = bodyParsed.data;
      const reminder = await createBookingReminderTemplate(getDb(), {
        tenantId: paramParsed.data,
        offsetMinutes: b.offset_minutes,
        kind: b.kind ?? 'reminder',
        type: b.type,
        textTemplate: b.text_template ?? null,
        flowNs: b.flow_ns ?? null,
        description: b.description ?? null,
        sortOrder: b.sort_order ?? 0,
      });
      req.log.info({ reminder_id: reminder.id }, 'booking reminder created');
      return reply.code(201).send(reminder);
    },
  );

  // PUT /admin/booking-reminders/:id
  app.put<{ Params: { id: string } }>(
    '/admin/booking-reminders/:id',
    doc({
      tags: ['admin/followups'],
      summary: 'Actualizar recordatorio de cita (parcial)',
      security: adminSecurity,
      params: uuidParams('id'),
      body: zodDoc(UpdateBookingReminderBodySchema),
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
      const existing = await getBookingReminderTemplateById(getDb(), paramParsed.data);
      if (!existing) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }
      const bodyParsed = UpdateBookingReminderBodySchema.safeParse(req.body);
      if (!bodyParsed.success) {
        return reply
          .code(400)
          .send({ error: { code: 'INVALID_PAYLOAD', details: bodyParsed.error.issues } });
      }
      const patch = bodyParsed.data;
      const drizzlePatch: Parameters<typeof updateBookingReminderTemplate>[2] = {};
      if (patch.offset_minutes !== undefined) drizzlePatch.offsetMinutes = patch.offset_minutes;
      if (patch.kind !== undefined) drizzlePatch.kind = patch.kind;
      if (patch.type !== undefined) drizzlePatch.type = patch.type;
      if ('text_template' in patch) drizzlePatch.textTemplate = patch.text_template ?? null;
      if ('flow_ns' in patch) drizzlePatch.flowNs = patch.flow_ns ?? null;
      if ('description' in patch) drizzlePatch.description = patch.description ?? null;
      if (patch.is_active !== undefined) drizzlePatch.isActive = patch.is_active;
      if (patch.sort_order !== undefined) drizzlePatch.sortOrder = patch.sort_order;

      const updated = await updateBookingReminderTemplate(getDb(), paramParsed.data, drizzlePatch);
      if (!updated) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }
      req.log.info({ reminder_id: updated.id }, 'booking reminder updated');
      return reply.code(200).send(updated);
    },
  );

  // DELETE /admin/booking-reminders/:id
  app.delete<{ Params: { id: string } }>(
    '/admin/booking-reminders/:id',
    doc({
      tags: ['admin/followups'],
      summary: 'Eliminar recordatorio de cita',
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
      const existing = await getBookingReminderTemplateById(getDb(), paramParsed.data);
      if (!existing) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }
      await deleteBookingReminderTemplate(getDb(), paramParsed.data);
      req.log.info({ reminder_id: paramParsed.data }, 'booking reminder deleted');
      return reply.code(200).send({ id: paramParsed.data, deleted: true });
    },
  );
}
