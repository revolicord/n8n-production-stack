import type { ChannelAdapter } from '@dm-api/agent';
import { type DbClient, conversations, leadFollowupLog, messagesRaw } from '@dm-api/db';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import {
  type DueBookingReminder,
  getDueBookingReminders,
  markReminderSent,
} from '../services/bookings.js';
import {
  buildContentMessages,
  buildMemoryText,
  formatBookingStart,
  interpolate,
  interpolateBooking,
  isWithinWindow,
  nextWindowStart,
  renderVars,
} from '../services/followup-render.js';
import {
  type DueLead,
  advanceCron,
  archiveCron,
  deferCron,
  getDueLeads,
} from '../services/lead-crons.js';
import { parseTenantConfig } from '../services/tenants.js';

export interface FollowupRunnerResult {
  processed: number;
  sent: number;
  archived: number;
  skipped: number;
  failed: number;
  remindersSent: number;
  remindersFailed: number;
}

const BATCH_LIMIT = 50;

/** Carga perezosa del adaptador ManyChat (vive en @dm-api/agent, deps pesadas). */
async function getAdapterFactory(): Promise<{
  createManyChatAdapter: (apiKey: string) => ChannelAdapter;
  createDryRunAdapter: () => ChannelAdapter;
}> {
  const mod = await import('@dm-api/agent');
  return {
    createManyChatAdapter: mod.createManyChatAdapter,
    createDryRunAdapter: mod.createDryRunAdapter,
  };
}

interface SendOutcome {
  success: boolean;
  errorBody?: string;
  hasMedia: boolean;
  mediaUrls: string[];
}

async function sendFollowup(channel: ChannelAdapter, lead: DueLead): Promise<SendOutcome> {
  const vars = renderVars(lead);
  if (lead.followupType === 'text') {
    const text = interpolate(lead.textTemplate, vars);
    const res = await channel.sendText(text, lead.manychatSubscriberId);
    return { success: res.success, errorBody: res.errorBody, hasMedia: false, mediaUrls: [] };
  }
  if (lead.followupType === 'flow') {
    const res = await channel.sendFlow(lead.followupFlowNs ?? '', lead.manychatSubscriberId);
    return { success: res.success, errorBody: res.errorBody, hasMedia: false, mediaUrls: [] };
  }
  // content
  const messages = buildContentMessages(lead);
  const mediaUrls = messages.filter((m) => m.type === 'image').map((m) => m.url);
  const res = await channel.sendContent(messages, lead.manychatSubscriberId);
  return {
    success: res.success,
    errorBody: res.errorBody,
    hasMedia: mediaUrls.length > 0,
    mediaUrls,
  };
}

/** Registra el follow-up enviado: log inmutable + memoria del agente (messages_raw). */
async function recordSent(db: DbClient, lead: DueLead, outcome: SendOutcome): Promise<void> {
  const memoryText = buildMemoryText(lead);

  await db.insert(leadFollowupLog).values({
    tenantId: lead.tenantId,
    subscriberId: lead.subscriberId,
    conversationId: lead.conversationId,
    stageId: lead.currentStageId,
    templateId: lead.templateId,
    sequenceNumber: lead.nextSequenceNumber,
    textSent: memoryText,
    status: 'sent',
  });

  // El agente lee su memoria de messages_raw (no de n8n_chat_histories): registrar
  // el follow-up como mensaje saliente para que no re-salude a un lead recién contactado.
  await db
    .insert(messagesRaw)
    .values({
      tenantId: lead.tenantId,
      subscriberId: lead.subscriberId,
      channel: 'instagram',
      externalMessageId: null,
      idempotencyHash: `followup:${lead.cronId}:${lead.nextSequenceNumber}`,
      direction: 'out',
      payload: {
        followup: true,
        template_id: lead.templateId,
        sequence_number: lead.nextSequenceNumber,
      },
      text: memoryText,
      hasMedia: outcome.hasMedia,
      mediaUrls: outcome.mediaUrls,
    })
    .onConflictDoNothing();

  await db
    .update(conversations)
    .set({ lastBotMsgAt: sql`now()` })
    .where(eq(conversations.id, lead.conversationId));
}

async function recordFailed(db: DbClient, lead: DueLead, errorBody?: string): Promise<void> {
  await db.insert(leadFollowupLog).values({
    tenantId: lead.tenantId,
    subscriberId: lead.subscriberId,
    conversationId: lead.conversationId,
    stageId: lead.currentStageId,
    templateId: lead.templateId,
    sequenceNumber: lead.nextSequenceNumber,
    textSent: null,
    status: 'failed',
    error: errorBody ?? 'unknown error',
  });
}

/**
 * Job repetible (cada FOLLOWUP_INTERVAL_MINUTES): migración a código del workflow
 * n8n "followup-runner". Toma los leads con follow-up vencido, los envía por ManyChat
 * según su template (text/flow/content), lo registra y avanza o archiva el cron.
 */
export async function followupRunnerJob(): Promise<FollowupRunnerResult> {
  const log = logger().child({ job: 'followup-runner' });
  const db = getDb();
  const now = new Date();

  const due = await getDueLeads(db, { limit: BATCH_LIMIT });
  const result: FollowupRunnerResult = {
    processed: due.length,
    sent: 0,
    archived: 0,
    skipped: 0,
    failed: 0,
    remindersSent: 0,
    remindersFailed: 0,
  };

  const { createManyChatAdapter, createDryRunAdapter } = await getAdapterFactory();

  for (const lead of due) {
    const config = parseTenantConfig(lead.tenantConfig);

    // Guards (orden barato → caro).
    if (config.followups_enabled === false) {
      result.skipped++;
      continue;
    }
    if (lead.subscriberStatus !== 'active') {
      result.skipped++;
      continue;
    }
    if (lead.pausedUntil && lead.pausedUntil > now) {
      result.skipped++;
      continue;
    }
    if (lead.isTerminal) {
      await archiveCron(db, lead.cronId, 'stage_advanced');
      result.archived++;
      continue;
    }
    // Sin template en esta secuencia o más allá del máximo → fin de secuencia.
    const beyondMax = lead.maxFollowups != null && lead.nextSequenceNumber > lead.maxFollowups;
    if (!lead.templateId || beyondMax) {
      await archiveCron(db, lead.cronId, 'max_followups');
      result.archived++;
      continue;
    }
    // Quiet hours: posponer al próximo inicio de ventana, sin avanzar la secuencia.
    if (config.followup_window && !isWithinWindow(config.followup_window, now)) {
      await deferCron(db, lead.cronId, nextWindowStart(config.followup_window, now));
      result.skipped++;
      continue;
    }

    const apiKey = config.manychat_api_key ?? '';
    const channel = apiKey ? createManyChatAdapter(apiKey) : createDryRunAdapter();

    try {
      const outcome = await sendFollowup(channel, lead);
      if (outcome.success) {
        await recordSent(db, lead, outcome);
        if (lead.nextDelayMinutes != null) {
          await advanceCron(db, lead.cronId, lead.nextDelayMinutes);
        } else {
          await archiveCron(db, lead.cronId, 'max_followups');
        }
        result.sent++;
      } else {
        await recordFailed(db, lead, outcome.errorBody);
        result.failed++;
        log.warn(
          { cron_id: lead.cronId, seq: lead.nextSequenceNumber, error: outcome.errorBody },
          'followup send failed; will retry next tick',
        );
      }
    } catch (err) {
      await recordFailed(db, lead, err instanceof Error ? err.message : String(err));
      result.failed++;
      log.error({ err, cron_id: lead.cronId }, 'followup send threw');
    }
  }

  // Segunda pasada: recordatorios de cita post-agendamiento (anclados a la hora de la
  // cita, no a quiet hours — el lead eligió ese horario).
  const reminders = await getDueBookingReminders(db);
  for (const reminder of reminders) {
    const config = parseTenantConfig(reminder.tenantConfig);
    if (config.followups_enabled === false) continue;
    if (reminder.subscriberStatus !== 'active') continue;

    const apiKey = config.manychat_api_key ?? '';
    const channel = apiKey ? createManyChatAdapter(apiKey) : createDryRunAdapter();
    try {
      const outcome = await sendReminder(channel, reminder);
      await markReminderSent(db, {
        tenantId: reminder.tenantId,
        bookingId: reminder.bookingId,
        templateId: reminder.templateId,
        status: outcome.success ? 'sent' : 'failed',
        error: outcome.errorBody,
      });
      if (outcome.success) {
        await recordReminderMemory(db, reminder);
        result.remindersSent++;
      } else {
        result.remindersFailed++;
        log.warn(
          { booking_id: reminder.bookingId, error: outcome.errorBody },
          'booking reminder send failed',
        );
      }
    } catch (err) {
      await markReminderSent(db, {
        tenantId: reminder.tenantId,
        bookingId: reminder.bookingId,
        templateId: reminder.templateId,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
      result.remindersFailed++;
      log.error({ err, booking_id: reminder.bookingId }, 'booking reminder threw');
    }
  }

  log.info(result, 'followup-runner tick done');
  return result;
}

interface ReminderOutcome {
  success: boolean;
  errorBody?: string;
}

function reminderText(reminder: DueBookingReminder): string {
  return interpolateBooking(reminder.textTemplate, {
    name: reminder.displayName ?? '',
    startTime: formatBookingStart(reminder.startTime, reminder.timezone),
    joinUrl: reminder.joinUrl ?? '',
  });
}

async function sendReminder(
  channel: ChannelAdapter,
  reminder: DueBookingReminder,
): Promise<ReminderOutcome> {
  if (reminder.type === 'flow') {
    const res = await channel.sendFlow(reminder.flowNs ?? '', reminder.manychatSubscriberId);
    return { success: res.success, errorBody: res.errorBody };
  }
  const res = await channel.sendText(reminderText(reminder), reminder.manychatSubscriberId);
  return { success: res.success, errorBody: res.errorBody };
}

/** Registra el recordatorio en la memoria del agente (messages_raw). */
async function recordReminderMemory(db: DbClient, reminder: DueBookingReminder): Promise<void> {
  const body =
    reminder.type === 'flow'
      ? `[flow: ${reminder.flowNs ?? ''}] — ${reminder.description ?? ''}`
      : reminderText(reminder);
  const memoryText = `[RECORDATORIO DE CITA] ${body}`.trim();

  await db
    .insert(messagesRaw)
    .values({
      tenantId: reminder.tenantId,
      subscriberId: reminder.subscriberId,
      channel: 'instagram',
      externalMessageId: null,
      idempotencyHash: `booking-reminder:${reminder.bookingId}:${reminder.templateId}`,
      direction: 'out',
      payload: {
        booking_reminder: true,
        booking_id: reminder.bookingId,
        template_id: reminder.templateId,
        kind: reminder.kind,
      },
      text: memoryText,
      hasMedia: false,
      mediaUrls: [],
    })
    .onConflictDoNothing();

  if (reminder.conversationId) {
    await db
      .update(conversations)
      .set({ lastBotMsgAt: sql`now()` })
      .where(eq(conversations.id, reminder.conversationId));
  }
}
