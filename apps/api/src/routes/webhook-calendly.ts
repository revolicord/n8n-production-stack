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
import { debouncePush } from '../services/debounce.js';
import { createStageTransition, getLeadStage, upsertLeadStage } from '../services/lead-stages.js';
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
        'avanza la etapa a D, persiste el booking en subscribers.metadata y dispara ' +
        'un system_event para que el agente responda con confirmación + audio + video.',
    }),
    async (req, reply) => {
      const log = req.log.child({ route: 'webhook-calendly' });

      const parsed = CalendlyWebhookBodySchema.safeParse(req.body);
      if (!parsed.success) {
        log.warn({ issues: parsed.error.issues }, 'calendly webhook: invalid body');
        return reply.code(200).send({ ok: false, reason: 'invalid_body' });
      }

      const { event, payload } = parsed.data;

      // Only handle invitee.created
      if (event !== 'invitee.created') {
        return reply.code(200).send({ ok: true, reason: 'ignored_event' });
      }

      const subscriberId = payload.tracking?.utm_content?.trim();
      if (!subscriberId) {
        log.warn('calendly webhook: no utm_content, cannot identify subscriber');
        return reply.code(200).send({ ok: false, reason: 'no_utm_content' });
      }

      // Idempotency: one processing per invitee URI
      const idempotencyKey = `calendly:idempotent:${payload.uri}`;
      const redis = getRedis();
      const already = await redis.set(idempotencyKey, '1', 'EX', IDEMPOTENCY_TTL_S, 'NX');
      if (already === null) {
        log.info({ invitee_uri: payload.uri }, 'calendly webhook: duplicate, skipping');
        return reply.code(200).send({ ok: true, reason: 'duplicate' });
      }

      const db = getDb();
      const subscriber = await getSubscriberByUuid(db, subscriberId);
      if (!subscriber) {
        log.warn({ subscriber_id: subscriberId }, 'calendly webhook: subscriber not found');
        return reply.code(200).send({ ok: false, reason: 'subscriber_not_found' });
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

      // Advance to stage D — bypass transition validation (external trigger)
      const fromStage = await getLeadStage(db, {
        tenantId: subscriber.tenantId,
        subscriberId: subscriber.id,
      });

      if (fromStage !== 'D') {
        await upsertLeadStage(db, {
          tenantId: subscriber.tenantId,
          subscriberId: subscriber.id,
          stage: 'D',
        });

        await createStageTransition(db, {
          tenantId: subscriber.tenantId,
          subscriberId: subscriber.id,
          turnId: null,
          fromStage,
          toStage: 'D',
          reason: 'calendly_booked',
          agentEvidence: `Calendly invitee.created @ ${startTimeRaw} — ${payload.uri}`,
        });
      }

      log.info(
        { subscriber_id: subscriberId, from_stage: fromStage, start_time: startTimeRaw },
        'calendly booking processed',
      );

      // Inject StartFlow command so the agent deterministically runs audio + video
      const startFlowCmd: DialogueCommand = {
        type: 'StartFlow',
        flow_id: 'qc_booking_confirmed',
        inputs: {},
        evidence: `booking_confirmed @ ${startTimeRaw}`,
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
          system_commands: [startFlowCmd],
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
