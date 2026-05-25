import {
  db,
  followupTemplates,
  funnelStages,
  leadContentSent,
  leadFollowupLog,
  leadStages,
  subscribers,
} from '@/lib/db';
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import { getPeriodRange } from './_helpers';

/** Etapas con secuencia de follow-ups que se muestran como columnas (1B, 2B… / 1C…). */
const FOLLOWUP_STAGES = ['B', 'C'];

/** Una celda de follow-up para un lead concreto. */
export interface FollowupCell {
  stage: string;
  sequence: number;
  sentAt: Date | null;
  respondedAt: Date | null;
}

/** Cabecera de columna de follow-up derivada del catálogo del tenant. `label` = "1B", "2B"… */
export interface FollowupColumn {
  stage: string;
  sequence: number;
  label: string;
}

export interface LeadRow {
  subscriberId: string;
  displayName: string | null;
  igUsername: string | null;
  /** `https://instagram.com/{igUsername}` o null si no hay usuario IG. */
  profileUrl: string | null;
  /** firstSeenAt → columna "1A". */
  initiatedAt: Date;
  /** Etapa actual del lead (A | MS | B | C | D | slugs terminales). */
  currentStage: string;
  /** min(leadContentSent.sentAt) del lead → columna "MS". */
  mediaSentAt: Date | null;
  followups: FollowupCell[];
}

export interface ProspectsView {
  columns: FollowupColumn[];
  leads: LeadRow[];
}

/** Columnas de follow-up del tenant (catálogo), ordenadas por posición de etapa y secuencia. */
async function getFollowupColumns(tenantId: string): Promise<FollowupColumn[]> {
  const rows = await db
    .select({
      stage: funnelStages.slug,
      sequence: followupTemplates.sequenceNumber,
      position: funnelStages.position,
    })
    .from(followupTemplates)
    .innerJoin(funnelStages, eq(funnelStages.id, followupTemplates.stageId))
    .where(
      and(eq(followupTemplates.tenantId, tenantId), inArray(funnelStages.slug, FOLLOWUP_STAGES)),
    )
    .orderBy(asc(funnelStages.position), asc(followupTemplates.sequenceNumber));

  // (slug, sequence) es único por tenant, pero deduplicamos por si acaso.
  const seen = new Set<string>();
  const columns: FollowupColumn[] = [];
  for (const r of rows) {
    const key = `${r.stage}:${r.sequence}`;
    if (seen.has(key)) continue;
    seen.add(key);
    columns.push({ stage: r.stage, sequence: r.sequence, label: `${r.sequence}${r.stage}` });
  }
  return columns;
}

/**
 * Devuelve los leads iniciados en (year, month) con su etapa actual, fecha de media
 * y todos sus follow-ups, junto a las columnas de follow-up del tenant. Solo lectura.
 */
export async function getLeadsForMonth(args: {
  tenantId: string;
  year: number;
  month: number;
}): Promise<ProspectsView> {
  const { tenantId, year, month } = args;
  const { start, end } = getPeriodRange(year, month);

  const columns = await getFollowupColumns(tenantId);

  // 1. Cohorte: subscribers iniciados en el mes.
  const subs = await db
    .select({
      id: subscribers.id,
      displayName: subscribers.displayName,
      igUsername: subscribers.igUsername,
      firstSeenAt: subscribers.firstSeenAt,
    })
    .from(subscribers)
    .where(
      and(
        eq(subscribers.tenantId, tenantId),
        gte(subscribers.firstSeenAt, start),
        lt(subscribers.firstSeenAt, end),
      ),
    )
    .orderBy(asc(subscribers.firstSeenAt));

  if (subs.length === 0) return { columns, leads: [] };

  const ids = subs.map((s) => s.id);

  // 2. Etapa actual por lead.
  const stages = await db
    .select({ subscriberId: leadStages.subscriberId, currentStage: leadStages.currentStage })
    .from(leadStages)
    .where(and(eq(leadStages.tenantId, tenantId), inArray(leadStages.subscriberId, ids)));
  const stageMap = new Map(stages.map((s) => [s.subscriberId, s.currentStage]));

  // 3. Media enviada: nos quedamos con la fecha más temprana por lead → columna "MS".
  const media = await db
    .select({ subscriberId: leadContentSent.subscriberId, sentAt: leadContentSent.sentAt })
    .from(leadContentSent)
    .where(and(eq(leadContentSent.tenantId, tenantId), inArray(leadContentSent.subscriberId, ids)));
  const mediaMap = new Map<string, Date>();
  for (const m of media) {
    const prev = mediaMap.get(m.subscriberId);
    if (!prev || m.sentAt < prev) mediaMap.set(m.subscriberId, m.sentAt);
  }

  // 4. Follow-ups (slug de etapa vía join a funnel_stages por stage_id del propio log).
  const fups = await db
    .select({
      subscriberId: leadFollowupLog.subscriberId,
      sentAt: leadFollowupLog.sentAt,
      respondedAt: leadFollowupLog.respondedAt,
      sequence: leadFollowupLog.sequenceNumber,
      stage: funnelStages.slug,
    })
    .from(leadFollowupLog)
    .innerJoin(funnelStages, eq(funnelStages.id, leadFollowupLog.stageId))
    .where(and(eq(leadFollowupLog.tenantId, tenantId), inArray(leadFollowupLog.subscriberId, ids)));
  const fupMap = new Map<string, FollowupCell[]>();
  for (const f of fups) {
    const cell: FollowupCell = {
      stage: f.stage,
      sequence: f.sequence,
      sentAt: f.sentAt ?? null,
      respondedAt: f.respondedAt ?? null,
    };
    const list = fupMap.get(f.subscriberId);
    if (list) list.push(cell);
    else fupMap.set(f.subscriberId, [cell]);
  }

  // 5. Ensamblar.
  const leads: LeadRow[] = subs.map((sub) => ({
    subscriberId: sub.id,
    displayName: sub.displayName,
    igUsername: sub.igUsername,
    profileUrl: sub.igUsername ? `https://instagram.com/${sub.igUsername}` : null,
    initiatedAt: sub.firstSeenAt,
    currentStage: stageMap.get(sub.id) ?? 'A',
    mediaSentAt: mediaMap.get(sub.id) ?? null,
    followups: fupMap.get(sub.id) ?? [],
  }));

  return { columns, leads };
}
