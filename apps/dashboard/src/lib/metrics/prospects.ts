import {
  db,
  followupTemplates,
  funnelStages,
  leadContentSent,
  leadFollowupLog,
  leadStages,
  subscribers,
} from '@/lib/db';
import { and, asc, count, desc, eq, gte, ilike, inArray, lt, or, sql } from 'drizzle-orm';
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
  /** Pausa manual vigente (escalado a humano): la fila se marca en rojo. */
  isPaused: boolean;
  followups: FollowupCell[];
}

/** Una página de la tabla de prospectos: columnas de follow-up, leads y total para el paginador. */
export interface ProspectsPage {
  columns: FollowupColumn[];
  leads: LeadRow[];
  total: number;
}

/** Datos de una columna del Kanban: total real de la etapa y los leads recortados (top-N). */
export interface KanbanStage {
  slug: string;
  total: number;
  leads: LeadRow[];
}

export type ProspectsSort = 'recent' | 'old';

/** Subscriber mínimo que necesita `enrichLeads` para ensamblar un `LeadRow`. */
interface LeadSub {
  id: string;
  displayName: string | null;
  igUsername: string | null;
  firstSeenAt: Date;
  status: string;
  pausedUntil: Date | null;
}

/** Pausa vigente: status='paused' indefinida (pausedUntil null) o aún no expirada. */
function isLeadPaused(sub: Pick<LeadSub, 'status' | 'pausedUntil'>, now: Date): boolean {
  return sub.status === 'paused' && (!sub.pausedUntil || sub.pausedUntil > now);
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
 * Enriquece una lista de subscribers (la cohorte ya paginada/recortada) con su etapa actual,
 * fecha de media y follow-ups, preservando el orden de entrada. Restringe cada consulta a los
 * ids recibidos vía `inArray`, así solo se trae lo de la página visible.
 */
async function enrichLeads(tenantId: string, subs: LeadSub[]): Promise<LeadRow[]> {
  if (subs.length === 0) return [];

  const ids = subs.map((s) => s.id);

  // Etapa actual por lead.
  const stages = await db
    .select({ subscriberId: leadStages.subscriberId, currentStage: leadStages.currentStage })
    .from(leadStages)
    .where(and(eq(leadStages.tenantId, tenantId), inArray(leadStages.subscriberId, ids)));
  const stageMap = new Map(stages.map((s) => [s.subscriberId, s.currentStage]));

  // Media enviada: nos quedamos con la fecha más temprana por lead → columna "MS".
  const media = await db
    .select({ subscriberId: leadContentSent.subscriberId, sentAt: leadContentSent.sentAt })
    .from(leadContentSent)
    .where(and(eq(leadContentSent.tenantId, tenantId), inArray(leadContentSent.subscriberId, ids)));
  const mediaMap = new Map<string, Date>();
  for (const m of media) {
    const prev = mediaMap.get(m.subscriberId);
    if (!prev || m.sentAt < prev) mediaMap.set(m.subscriberId, m.sentAt);
  }

  // Follow-ups (slug de etapa vía join a funnel_stages por stage_id del propio log).
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

  const now = new Date();
  return subs.map((sub) => ({
    subscriberId: sub.id,
    displayName: sub.displayName,
    igUsername: sub.igUsername,
    profileUrl: sub.igUsername ? `https://instagram.com/${sub.igUsername}` : null,
    initiatedAt: sub.firstSeenAt,
    currentStage: stageMap.get(sub.id) ?? 'A',
    mediaSentAt: mediaMap.get(sub.id) ?? null,
    isPaused: isLeadPaused(sub, now),
    followups: fupMap.get(sub.id) ?? [],
  }));
}

/**
 * Devuelve una página de la tabla de prospectos del mes (year, month) con paginación
 * server-side (LIMIT/OFFSET + COUNT), búsqueda por nombre/@usuario, filtro por etapa y orden.
 * Solo lectura.
 *
 * El filtro de etapa usa `COALESCE(current_stage,'A')` (LEFT JOIN a lead_stages, único por
 * subscriber) para incluir leads sin fila en lead_stages al filtrar por la etapa por defecto 'A'.
 */
export async function getProspectsPage(args: {
  tenantId: string;
  year: number;
  month: number;
  page: number;
  size: number;
  q?: string;
  stage?: string;
  sort: ProspectsSort;
}): Promise<ProspectsPage> {
  const { tenantId, year, month, page, size, q, stage, sort } = args;
  const { start, end } = getPeriodRange(year, month);

  const columns = await getFollowupColumns(tenantId);

  const conditions = [
    eq(subscribers.tenantId, tenantId),
    gte(subscribers.firstSeenAt, start),
    lt(subscribers.firstSeenAt, end),
  ];
  const term = q?.trim();
  if (term) {
    const pattern = `%${term}%`;
    const search = or(
      ilike(subscribers.displayName, pattern),
      ilike(subscribers.igUsername, pattern),
    );
    if (search) conditions.push(search);
  }
  if (stage) {
    conditions.push(sql`coalesce(${leadStages.currentStage}, 'A') = ${stage}`);
  }
  const where = and(...conditions);

  // lead_stages es único por (tenant, subscriber) → el LEFT JOIN no altera la cardinalidad.
  const totalRows = await db
    .select({ n: count() })
    .from(subscribers)
    .leftJoin(
      leadStages,
      and(eq(leadStages.subscriberId, subscribers.id), eq(leadStages.tenantId, tenantId)),
    )
    .where(where);
  const total = Number(totalRows[0]?.n ?? 0);

  const subs = await db
    .select({
      id: subscribers.id,
      displayName: subscribers.displayName,
      igUsername: subscribers.igUsername,
      firstSeenAt: subscribers.firstSeenAt,
      status: subscribers.status,
      pausedUntil: subscribers.pausedUntil,
    })
    .from(subscribers)
    .leftJoin(
      leadStages,
      and(eq(leadStages.subscriberId, subscribers.id), eq(leadStages.tenantId, tenantId)),
    )
    .where(where)
    .orderBy(sort === 'old' ? asc(subscribers.firstSeenAt) : desc(subscribers.firstSeenAt))
    .limit(size)
    .offset((page - 1) * size);

  const leads = await enrichLeads(tenantId, subs);
  return { columns, leads, total };
}

/**
 * Datos del Kanban: por cada etapa actual de la cohorte del mes, el total real y hasta
 * `perColumn` leads (los más recientes). Una sola consulta con window functions resuelve
 * conteo + recorte; luego `enrichLeads` añade media/follow-ups. Solo lectura.
 */
export async function getProspectsKanban(args: {
  tenantId: string;
  year: number;
  month: number;
  perColumn: number;
}): Promise<KanbanStage[]> {
  const { tenantId, year, month, perColumn } = args;
  const { start, end } = getPeriodRange(year, month);

  const rows = (await db.execute(sql`
    SELECT id, display_name, ig_username, first_seen_at, status, paused_until, current_stage, total
    FROM (
      SELECT
        s.id,
        s.display_name,
        s.ig_username,
        s.first_seen_at,
        s.status,
        s.paused_until,
        COALESCE(ls.current_stage, 'A') AS current_stage,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(ls.current_stage, 'A')
          ORDER BY s.first_seen_at DESC, s.id
        ) AS rn,
        COUNT(*) OVER (PARTITION BY COALESCE(ls.current_stage, 'A')) AS total
      FROM api.subscribers s
      LEFT JOIN api.lead_stages ls
        ON ls.subscriber_id = s.id AND ls.tenant_id = ${tenantId}
      WHERE s.tenant_id = ${tenantId}
        AND s.first_seen_at >= ${start.toISOString()}::timestamptz
        AND s.first_seen_at <  ${end.toISOString()}::timestamptz
    ) q
    WHERE rn <= ${perColumn}
    ORDER BY current_stage, rn
  `)) as unknown as Array<{
    id: string;
    display_name: string | null;
    ig_username: string | null;
    first_seen_at: string | Date;
    status: string;
    paused_until: string | Date | null;
    current_stage: string;
    total: number | string;
  }>;

  // Conserva el orden del SQL (recencia dentro de cada etapa) para enrichLeads.
  const subs: LeadSub[] = rows.map((r) => ({
    id: r.id,
    displayName: r.display_name,
    igUsername: r.ig_username,
    firstSeenAt: new Date(r.first_seen_at),
    status: r.status,
    pausedUntil: r.paused_until ? new Date(r.paused_until) : null,
  }));
  const leads = await enrichLeads(tenantId, subs);

  // Agrupar por etapa preservando orden; total real viene del COUNT OVER.
  const byStage = new Map<string, KanbanStage>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const lead = leads[i];
    if (!row || !lead) continue;
    const existing = byStage.get(row.current_stage);
    if (existing) existing.leads.push(lead);
    else
      byStage.set(row.current_stage, {
        slug: row.current_stage,
        total: Number(row.total),
        leads: [lead],
      });
  }

  return [...byStage.values()];
}
