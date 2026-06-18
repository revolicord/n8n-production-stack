import {
  type BookingReminderTemplate,
  type DbClient,
  type NewBookingReminderTemplate,
  bookingReminderLog,
  bookingReminderTemplates,
  bookings,
  subscribers,
  tenants,
} from '@dm-api/db';
import { and, asc, eq, isNotNull, isNull, lte, sql } from 'drizzle-orm';

export interface UpsertBookingArgs {
  tenantId: string;
  subscriberId: string;
  conversationId: string | null;
  provider?: string;
  eventUri: string | null;
  inviteeUri: string;
  startTime: Date | null;
  endTime: Date | null;
  joinUrl: string | null;
  rescheduleUrl: string | null;
  cancelUrl: string | null;
  inviteeEmail: string | null;
  timezone: string | null;
}

/**
 * Inserta/actualiza una cita por `(tenant_id, invitee_uri)`. Un reagendamiento en
 * Calendly llega como invitee.canceled + nuevo invitee.created (URI distinto), así
 * que cada cita activa es una fila propia con status reseteado a 'scheduled'.
 */
export async function upsertBooking(db: DbClient, args: UpsertBookingArgs): Promise<string> {
  const rows = await db
    .insert(bookings)
    .values({
      tenantId: args.tenantId,
      subscriberId: args.subscriberId,
      conversationId: args.conversationId,
      provider: args.provider ?? 'calendly',
      eventUri: args.eventUri,
      inviteeUri: args.inviteeUri,
      startTime: args.startTime,
      endTime: args.endTime,
      joinUrl: args.joinUrl,
      rescheduleUrl: args.rescheduleUrl,
      cancelUrl: args.cancelUrl,
      inviteeEmail: args.inviteeEmail,
      timezone: args.timezone,
      status: 'scheduled',
    })
    .onConflictDoUpdate({
      target: [bookings.tenantId, bookings.inviteeUri],
      set: {
        conversationId: args.conversationId,
        eventUri: args.eventUri,
        startTime: args.startTime,
        endTime: args.endTime,
        joinUrl: args.joinUrl,
        rescheduleUrl: args.rescheduleUrl,
        cancelUrl: args.cancelUrl,
        inviteeEmail: args.inviteeEmail,
        timezone: args.timezone,
        status: 'scheduled',
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: bookings.id });
  return rows[0]?.id ?? '';
}

/** Cancela una cita (invitee.canceled). Sus recordatorios pendientes dejan de salir. */
export async function cancelBooking(
  db: DbClient,
  args: { tenantId: string; inviteeUri: string },
): Promise<void> {
  await db
    .update(bookings)
    .set({ status: 'canceled', updatedAt: sql`now()` })
    .where(and(eq(bookings.tenantId, args.tenantId), eq(bookings.inviteeUri, args.inviteeUri)));
}

export interface DueBookingReminder {
  bookingId: string;
  tenantId: string;
  subscriberId: string;
  conversationId: string | null;
  startTime: Date | null;
  joinUrl: string | null;
  timezone: string | null;
  manychatSubscriberId: string;
  displayName: string | null;
  subscriberStatus: string;
  tenantConfig: unknown;
  templateId: string;
  kind: string;
  type: string; // 'text' | 'flow'
  textTemplate: string | null;
  flowNs: string | null;
  description: string | null;
}

/**
 * Recordatorios de cita vencidos: para cada cita `scheduled` y cada template activo
 * cuyo `start_time + offset_minutes <= now()` y que aún no se haya enviado
 * (sin fila en booking_reminder_log). Cancelar la cita elimina sus pendientes.
 */
export async function getDueBookingReminders(
  db: DbClient,
  opts: { limit?: number } = {},
): Promise<DueBookingReminder[]> {
  const limit = opts.limit ?? 100;
  return db
    .select({
      bookingId: bookings.id,
      tenantId: bookings.tenantId,
      subscriberId: bookings.subscriberId,
      conversationId: bookings.conversationId,
      startTime: bookings.startTime,
      joinUrl: bookings.joinUrl,
      timezone: bookings.timezone,
      manychatSubscriberId: subscribers.manychatSubscriberId,
      displayName: subscribers.displayName,
      subscriberStatus: subscribers.status,
      tenantConfig: tenants.config,
      templateId: bookingReminderTemplates.id,
      kind: bookingReminderTemplates.kind,
      type: bookingReminderTemplates.type,
      textTemplate: bookingReminderTemplates.textTemplate,
      flowNs: bookingReminderTemplates.flowNs,
      description: bookingReminderTemplates.description,
    })
    .from(bookings)
    .innerJoin(
      bookingReminderTemplates,
      and(
        eq(bookingReminderTemplates.tenantId, bookings.tenantId),
        eq(bookingReminderTemplates.isActive, true),
      ),
    )
    .innerJoin(subscribers, eq(subscribers.id, bookings.subscriberId))
    .innerJoin(tenants, eq(tenants.id, bookings.tenantId))
    .leftJoin(
      bookingReminderLog,
      and(
        eq(bookingReminderLog.bookingId, bookings.id),
        eq(bookingReminderLog.templateId, bookingReminderTemplates.id),
      ),
    )
    .where(
      and(
        eq(bookings.status, 'scheduled'),
        isNotNull(bookings.startTime),
        lte(
          sql`${bookings.startTime} + (${bookingReminderTemplates.offsetMinutes} * interval '1 minute')`,
          sql`now()`,
        ),
        isNull(bookingReminderLog.id),
      ),
    )
    .limit(limit);
}

/** Registra el envío (o fallo) de un recordatorio; sirve de dedup (unique booking+template). */
export async function markReminderSent(
  db: DbClient,
  args: {
    tenantId: string;
    bookingId: string;
    templateId: string;
    status: 'sent' | 'failed';
    error?: string;
  },
): Promise<void> {
  await db
    .insert(bookingReminderLog)
    .values({
      tenantId: args.tenantId,
      bookingId: args.bookingId,
      templateId: args.templateId,
      status: args.status,
      error: args.error ?? null,
    })
    .onConflictDoNothing();
}

// ── CRUD de templates de recordatorio (dashboard / admin) ────────────────────

export type { BookingReminderTemplate };

export async function listBookingReminderTemplates(
  db: DbClient,
  tenantId: string,
): Promise<BookingReminderTemplate[]> {
  return db
    .select()
    .from(bookingReminderTemplates)
    .where(eq(bookingReminderTemplates.tenantId, tenantId))
    .orderBy(asc(bookingReminderTemplates.sortOrder), asc(bookingReminderTemplates.offsetMinutes));
}

export async function getBookingReminderTemplateById(
  db: DbClient,
  id: string,
): Promise<BookingReminderTemplate | null> {
  const rows = await db
    .select()
    .from(bookingReminderTemplates)
    .where(eq(bookingReminderTemplates.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function createBookingReminderTemplate(
  db: DbClient,
  data: NewBookingReminderTemplate,
): Promise<BookingReminderTemplate> {
  const rows = await db.insert(bookingReminderTemplates).values(data).returning();
  const row = rows[0];
  if (!row) throw new Error('booking_reminder_templates insert returned no rows');
  return row;
}

export async function updateBookingReminderTemplate(
  db: DbClient,
  id: string,
  patch: Partial<
    Pick<
      BookingReminderTemplate,
      | 'offsetMinutes'
      | 'kind'
      | 'type'
      | 'textTemplate'
      | 'flowNs'
      | 'description'
      | 'isActive'
      | 'sortOrder'
    >
  >,
): Promise<BookingReminderTemplate | null> {
  const rows = await db
    .update(bookingReminderTemplates)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(bookingReminderTemplates.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function deleteBookingReminderTemplate(db: DbClient, id: string): Promise<void> {
  await db.delete(bookingReminderTemplates).where(eq(bookingReminderTemplates.id, id));
}
