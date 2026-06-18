import {
  type DbClient,
  followupMessages,
  followupTemplates,
  funnelStages,
  leadCrons,
  leadFollowupLog,
  subscribers,
  tenants,
} from '@dm-api/db';
import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

/** Mensaje individual de un template `type='content'`. */
export interface FollowupContentMessage {
  messageType: string; // 'text' | 'image'
  textContent: string | null;
  mediaUrl: string | null;
  sortOrder: number;
}

/** Lead con follow-up vencido + todo el contexto necesario para enviarlo. */
export interface DueLead {
  cronId: string;
  tenantId: string;
  subscriberId: string;
  conversationId: string;
  currentStageId: string | null;
  nextSequenceNumber: number;
  cronUpdatedAt: Date | null;
  manychatSubscriberId: string;
  displayName: string | null;
  subscriberStatus: string;
  pausedUntil: Date | null;
  tenantConfig: unknown;
  maxFollowups: number | null;
  stageSlug: string;
  isTerminal: boolean;
  callLink: string | null;
  nurtureVideoUrl: string | null;
  // Template de la secuencia actual (null si ya no existe → archivar).
  templateId: string | null;
  followupType: string | null; // 'text' | 'flow' | 'content'
  textTemplate: string | null;
  followupFlowNs: string | null;
  followupDescription: string | null;
  // Delay del template siguiente (null si no hay → archivar tras enviar).
  nextDelayMinutes: number | null;
  followupMessages: FollowupContentMessage[];
}

/**
 * Devuelve los leads con `next_followup_at <= now()` y su contexto de envío.
 * Port del nodo n8n "Get Due Leads": une `lead_crons` con subscriber, tenant,
 * etapa, el template de la secuencia actual y el siguiente (para el próximo delay).
 * Los mensajes de los templates `content` se cargan en una segunda consulta.
 */
export async function getDueLeads(db: DbClient, opts: { limit?: number } = {}): Promise<DueLead[]> {
  const limit = opts.limit ?? 50;
  const ft = alias(followupTemplates, 'ft');
  const ftNext = alias(followupTemplates, 'ft_next');

  const rows = await db
    .select({
      cronId: leadCrons.id,
      tenantId: leadCrons.tenantId,
      subscriberId: leadCrons.subscriberId,
      conversationId: leadCrons.conversationId,
      currentStageId: leadCrons.currentStageId,
      nextSequenceNumber: leadCrons.nextSequenceNumber,
      cronUpdatedAt: leadCrons.updatedAt,
      manychatSubscriberId: subscribers.manychatSubscriberId,
      displayName: subscribers.displayName,
      subscriberStatus: subscribers.status,
      pausedUntil: subscribers.pausedUntil,
      tenantConfig: tenants.config,
      maxFollowups: funnelStages.maxFollowups,
      stageSlug: funnelStages.slug,
      isTerminal: funnelStages.isTerminal,
      callLink: funnelStages.callLink,
      nurtureVideoUrl: funnelStages.nurtureVideoUrl,
      templateId: ft.id,
      followupType: ft.type,
      textTemplate: ft.textTemplate,
      followupFlowNs: ft.flowNs,
      followupDescription: ft.description,
      nextDelayMinutes: ftNext.delayMinutes,
    })
    .from(leadCrons)
    .innerJoin(subscribers, eq(subscribers.id, leadCrons.subscriberId))
    .innerJoin(tenants, eq(tenants.id, leadCrons.tenantId))
    .innerJoin(funnelStages, eq(funnelStages.id, leadCrons.currentStageId))
    .leftJoin(
      ft,
      and(
        eq(ft.stageId, leadCrons.currentStageId),
        eq(ft.sequenceNumber, leadCrons.nextSequenceNumber),
        eq(ft.isActive, true),
      ),
    )
    .leftJoin(
      ftNext,
      and(
        eq(ftNext.stageId, leadCrons.currentStageId),
        eq(ftNext.sequenceNumber, sql`${leadCrons.nextSequenceNumber} + 1`),
        eq(ftNext.isActive, true),
      ),
    )
    .where(and(eq(leadCrons.isActive, true), lte(leadCrons.nextFollowupAt, sql`now()`)))
    .orderBy(asc(leadCrons.nextFollowupAt))
    .limit(limit);

  // Cargar los mensajes de los templates content en una sola consulta.
  const contentTemplateIds = rows
    .filter((r) => r.followupType === 'content' && r.templateId)
    .map((r) => r.templateId as string);

  const messagesByTemplate = new Map<string, FollowupContentMessage[]>();
  if (contentTemplateIds.length > 0) {
    const msgs = await db
      .select({
        templateId: followupMessages.templateId,
        messageType: followupMessages.messageType,
        textContent: followupMessages.textContent,
        mediaUrl: followupMessages.mediaUrl,
        sortOrder: followupMessages.sortOrder,
      })
      .from(followupMessages)
      .where(inArray(followupMessages.templateId, contentTemplateIds))
      .orderBy(asc(followupMessages.sortOrder));

    for (const m of msgs) {
      const list = messagesByTemplate.get(m.templateId) ?? [];
      list.push({
        messageType: m.messageType,
        textContent: m.textContent,
        mediaUrl: m.mediaUrl,
        sortOrder: m.sortOrder,
      });
      messagesByTemplate.set(m.templateId, list);
    }
  }

  return rows.map((r) => ({
    ...r,
    nextSequenceNumber: r.nextSequenceNumber ?? 1,
    followupMessages: r.templateId ? (messagesByTemplate.get(r.templateId) ?? []) : [],
  }));
}

/**
 * Avanza el cron a la siguiente secuencia, programando el próximo envío a
 * `now() + nextDelayMinutes`. Reactiva el cron si estaba archivado.
 */
export async function advanceCron(
  db: DbClient,
  cronId: string,
  nextDelayMinutes: number,
): Promise<void> {
  await db
    .update(leadCrons)
    .set({
      nextSequenceNumber: sql`${leadCrons.nextSequenceNumber} + 1`,
      nextFollowupAt: sql`now() + (${nextDelayMinutes} * interval '1 minute')`,
      isActive: true,
      archivedAt: null,
      archiveReason: null,
      updatedAt: sql`now()`,
    })
    .where(eq(leadCrons.id, cronId));
}

/** Archiva (desactiva) un cron con un motivo. */
export async function archiveCron(db: DbClient, cronId: string, reason: string): Promise<void> {
  await db
    .update(leadCrons)
    .set({
      isActive: false,
      archivedAt: sql`now()`,
      archiveReason: reason,
      updatedAt: sql`now()`,
    })
    .where(eq(leadCrons.id, cronId));
}

/** Pospone el próximo envío a una hora concreta (p.ej. fuera de quiet hours). */
export async function deferCron(db: DbClient, cronId: string, nextFollowupAt: Date): Promise<void> {
  await db
    .update(leadCrons)
    .set({ nextFollowupAt, updatedAt: sql`now()` })
    .where(eq(leadCrons.id, cronId));
}

/**
 * El lead respondió: archiva sus crons activos (`lead_replied`) y marca como
 * respondidos los follow-ups ya enviados. Reemplaza el nodo n8n
 * "Mark Followups Responded". El agente re-programa vía `schedule_followup`
 * si la conversación vuelve a enfriarse.
 */
export async function resetActiveCronsOnReply(
  db: DbClient,
  args: { tenantId: string; subscriberId: string },
): Promise<void> {
  await db
    .update(leadCrons)
    .set({
      isActive: false,
      archivedAt: sql`now()`,
      archiveReason: 'lead_replied',
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(leadCrons.tenantId, args.tenantId),
        eq(leadCrons.subscriberId, args.subscriberId),
        eq(leadCrons.isActive, true),
      ),
    );

  await db
    .update(leadFollowupLog)
    .set({ respondedAt: sql`now()` })
    .where(
      and(
        eq(leadFollowupLog.tenantId, args.tenantId),
        eq(leadFollowupLog.subscriberId, args.subscriberId),
        eq(leadFollowupLog.status, 'sent'),
        isNull(leadFollowupLog.respondedAt),
      ),
    );
}

/**
 * Cancela los follow-ups activos de un lead porque entró a una etapa terminal.
 * Reemplaza la lista hardcodeada `STAGES_THAT_CANCEL_FOLLOWUPS`: el llamador
 * decide si la etapa es terminal consultando `funnel_stages.is_terminal`.
 */
export async function cancelActiveCrons(
  db: DbClient,
  args: { tenantId: string; subscriberId: string; reason?: string },
): Promise<void> {
  await db
    .update(leadCrons)
    .set({
      isActive: false,
      archivedAt: sql`now()`,
      archiveReason: args.reason ?? 'stage_advanced',
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(leadCrons.tenantId, args.tenantId),
        eq(leadCrons.subscriberId, args.subscriberId),
        eq(leadCrons.isActive, true),
      ),
    );
}
