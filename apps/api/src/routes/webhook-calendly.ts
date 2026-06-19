import { randomUUID } from 'node:crypto';
import type { DialogueCommand } from '@dm-api/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getConfig } from '../config.js';
import { getDb } from '../lib/db.js';
import { doc } from '../lib/openapi.js';
import { getProcessBatchQueue } from '../lib/queue.js';
import { getRedis } from '../lib/redis.js';
import { cancelBooking, upsertBooking } from '../services/bookings.js';
import { getOrCreateOpenConversation } from '../services/conversations.js';
import { debouncePush } from '../services/debounce.js';
import { cancelActiveCrons } from '../services/lead-crons.js';
import { getSubscriberByUuid } from '../services/subscribers.js';

const CalendlyWebhookBodySchema = z.object({
  event: z.string(),
  payload: z.object({
    uri: z.string(),
    email: z.string().optional().nullable(),
    timezone: z.string().optional().nullable(),
    cancel_url: z.string().optional().nullable(),
    reschedule_url: z.string().optional().nullable(),
    tracking: z
      .object({
        utm_content: z.string().optional().nullable(),
      })
      .optional(),
    scheduled_event: z
      .object({
        start_time: z.string().optional().nullable(),
        end_time: z.string().optional().nullable(),
        uri: z.string().optional().nullable(),
        location: z
          .object({
            join_url: z.string().optional().nullable(),
          })
          .optional()
          .nullable(),
      })
      .optional()
      .nullable(),
  }),
});

const IDEMPOTENCY_TTL_S = 86_400; // 24h

export default async function webhookCalendlyRoute(app: FastifyInstance): Promise<void> {
  const config = getConfig();

  app.post(
    '/webhook/calendly',
    doc({
      tags: ['webhooks'],
      summary: 'Calendly invitee.created webhook',
      description:
        'Recibe invitee.created de Calendly. Extrae subscriber_id de utm_content, ' +
        'persiste el booking (subscribers.metadata + tabla bookings) y dispara un ' +
        'system_event con un ChangeStage(→D, cascade) inyectado: la transición C→D la ' +
        'ejecuta el plan del agente (no el webhook), queda registrada como C→D y la ' +
        'cascada entrega audio + video. El LLM corre igual → el agente es consciente y ' +
        'añade el texto de confirmación.',
    }),
    async (req, reply) => {
      const log = req.log.child({ route: 'webhook-calendly' });

      const parsed = CalendlyWebhookBodySchema.safeParse(req.body);
      if (!parsed.success) {
        log.warn({ issues: parsed.error.issues }, 'calendly webhook: invalid body');
        return reply.code(200).send({ ok: false, reason: 'invalid_body' });
      }

      const { event, payload } = parsed.data;

      // Solo nos interesan creación y cancelación de citas.
      if (event !== 'invitee.created' && event !== 'invitee.canceled') {
        return reply.code(200).send({ ok: true, reason: 'ignored_event' });
      }

      const subscriberId = payload.tracking?.utm_content?.trim();
      if (!subscriberId) {
        log.warn('calendly webhook: no utm_content, cannot identify subscriber');
        return reply.code(200).send({ ok: false, reason: 'no_utm_content' });
      }

      // Idempotency: una vez por evento + invitee URI (created y canceled no colisionan).
      const idempotencyKey = `calendly:idempotent:${event}:${payload.uri}`;
      const redis = getRedis();
      const already = await redis.set(idempotencyKey, '1', 'EX', IDEMPOTENCY_TTL_S, 'NX');
      if (already === null) {
        log.info({ event, invitee_uri: payload.uri }, 'calendly webhook: duplicate, skipping');
        return reply.code(200).send({ ok: true, reason: 'duplicate' });
      }

      const db = getDb();
      const subscriber = await getSubscriberByUuid(db, subscriberId);
      if (!subscriber) {
        log.warn({ subscriber_id: subscriberId }, 'calendly webhook: subscriber not found');
        return reply.code(200).send({ ok: false, reason: 'subscriber_not_found' });
      }

      // Cancelación: marcar la cita como cancelada (sus recordatorios dejan de salir).
      if (event === 'invitee.canceled') {
        await cancelBooking(db, { tenantId: subscriber.tenantId, inviteeUri: payload.uri });
        log.info({ subscriber_id: subscriberId, invitee_uri: payload.uri }, 'calendly canceled');
        return reply.code(200).send({ ok: true, reason: 'canceled' });
      }

      // Format start_time in the invitee's timezone for the confirmation message
      const tz = payload.timezone ?? 'America/Santo_Domingo';
      const startTimeRaw = payload.scheduled_event?.start_time ?? null;
      const startTimeFormatted = startTimeRaw
        ? new Intl.DateTimeFormat('es', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: tz,
          }).format(new Date(startTimeRaw))
        : 'la fecha acordada';

      // Persist booking data to subscribers.metadata (merge with existing)
      const bookingJson = JSON.stringify({
        booking: {
          event_uri: payload.scheduled_event?.uri ?? null,
          invitee_uri: payload.uri,
          start_time: startTimeRaw,
          start_time_formatted: startTimeFormatted,
          end_time: payload.scheduled_event?.end_time ?? null,
          join_url: payload.scheduled_event?.location?.join_url ?? null,
          timezone: tz,
          reschedule_url: payload.reschedule_url ?? null,
          cancel_url: payload.cancel_url ?? null,
          invitee_email: payload.email ?? null,
          booked_at: new Date().toISOString(),
        },
      });

      await db.execute(
        sql`UPDATE api.subscribers
            SET metadata = COALESCE(metadata, '{}'::jsonb) || ${bookingJson}::jsonb
            WHERE id = ${subscriber.id}::uuid`,
      );

      // Persistir la cita en la tabla `bookings` (fuente para recordatorios y no-show).
      const conversation = await getOrCreateOpenConversation(db, {
        tenantId: subscriber.tenantId,
        subscriberId: subscriber.id,
      });
      await upsertBooking(db, {
        tenantId: subscriber.tenantId,
        subscriberId: subscriber.id,
        conversationId: conversation.id,
        eventUri: payload.scheduled_event?.uri ?? null,
        inviteeUri: payload.uri,
        startTime: startTimeRaw ? new Date(startTimeRaw) : null,
        endTime: payload.scheduled_event?.end_time
          ? new Date(payload.scheduled_event.end_time)
          : null,
        joinUrl: payload.scheduled_event?.location?.join_url ?? null,
        rescheduleUrl: payload.reschedule_url ?? null,
        cancelUrl: payload.cancel_url ?? null,
        inviteeEmail: payload.email ?? null,
        timezone: tz,
      });

      // NO avanzamos la etapa aquí. La transición C→D la ejecuta el PLAN del agente:
      // inyectamos abajo un `ChangeStage(→D, cascade:true, system_authorized:true)` como
      // system_command. El engine la registra como C→D (no como un salto opaco D→D del
      // webhook) y dispara la cascada `qc_cascade_c_d` (audio + video). `system_authorized`
      // hace que el engine OMITA la validación del mapa, así C→D se mantiene FUERA de
      // stage_transitions_map a propósito (anti-anzuelo: el LLM no la ve ni la dispara por
      // lo que diga el lead). El LLM corre igual → consciente + texto de confirmación.

      // El lead agendó: cancelar follow-ups de prospección activos (p. ej. el cron de C
      // "¿ya agendaste?"). D no es terminal, así que el avance de etapa no los cancela por
      // sí solo, y agendar es un webhook (no un reply IG), por lo que `resetActiveCronsOnReply`
      // tampoco dispara. Sin esto, el lead recibiría follow-ups de C tras haber agendado.
      // Los recordatorios de cita (tabla `bookings`) son un mecanismo aparte y no se ven
      // afectados.
      await cancelActiveCrons(db, {
        tenantId: subscriber.tenantId,
        subscriberId: subscriber.id,
        reason: 'calendly_booked',
      });

      log.info(
        { subscriber_id: subscriberId, start_time: startTimeRaw },
        'calendly booking processed',
      );

      // Inyecta el ChangeStage(→D, cascade) que el plan del agente ejecutará: avanza la
      // etapa C→D (validado contra stage_transitions_map), lo registra y dispara la
      // cascada `qc_cascade_c_d` (audio + video). El LLM corre igual (el mensaje lleva
      // texto) → el agente es consciente del agendamiento y añade el texto de confirmación.
      const changeStageCmd: DialogueCommand = {
        type: 'ChangeStage',
        to_stage: 'D',
        reason: 'calendly_booked',
        evidence: `booking_confirmed @ ${startTimeRaw} — ${payload.uri}`,
        cascade: true,
        // Autorizado por el sistema: el engine salta la validación de transiciones, así
        // C→D se mantiene FUERA de stage_transitions_map (anti-anzuelo) y aun así la
        // mueve este webhook confiable. Ver engine.ts y commands.ts.
        system_authorized: true,
      };

      const now = Date.now();
      const token = randomUUID();

      await debouncePush(redis, {
        tenantId: subscriber.tenantId,
        subscriberId: subscriber.id,
        message: {
          id: randomUUID(),
          external_message_id: null,
          text: `[booking_confirmed] ${subscriber.displayName ?? 'lead'} agendó la llamada para ${startTimeFormatted}`,
          reply_type: 'system_event',
          ts: now,
          media_urls: [],
          system_commands: [changeStageCmd],
        },
        token,
        debounceMs: config.DEBOUNCE_MS,
        maxWaitMs: config.MAX_WAIT_MS,
        now,
      });

      await getProcessBatchQueue().add(
        'process-batch',
        {
          tenantId: subscriber.tenantId,
          subscriberId: subscriber.id,
          token,
          reason: 'system_event',
        },
        {
          delay: 0,
          jobId: `calendly:${subscriber.tenantId}:${subscriber.id}:${token}`,
        },
      );

      return reply.code(200).send({ ok: true });
    },
  );
}
