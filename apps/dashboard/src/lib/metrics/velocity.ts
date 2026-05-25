import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

export type Velocity = {
  aToMs: number | null;
  msToB: number | null;
  bToC: number | null;
  cToD: number | null;
  aToD: number | null;
};

export async function getVelocity(args: {
  tenantId: string;
  start: Date;
  end: Date;
}): Promise<Velocity> {
  const { tenantId, start, end } = args;

  const aToMsRow = await db.execute(sql`
    SELECT AVG(EXTRACT(EPOCH FROM (lcs.first_sent - s.first_seen_at)) / 86400.0)::float AS avg
    FROM api.subscribers s
    JOIN (
      SELECT subscriber_id, MIN(sent_at) AS first_sent
      FROM api.lead_content_sent
      WHERE tenant_id = ${tenantId}
      GROUP BY subscriber_id
    ) lcs ON lcs.subscriber_id = s.id
    WHERE s.tenant_id = ${tenantId}
      AND s.first_seen_at >= ${start.toISOString()}::timestamptz
      AND s.first_seen_at <  ${end.toISOString()}::timestamptz
  `);

  type AvgRow = { avg: number | null };
  const aToMs = (aToMsRow[0] as AvgRow)?.avg ?? null;

  const msToBRow = await db.execute(sql`
    SELECT AVG(EXTRACT(EPOCH FROM (st.first_transition - lcs.first_sent)) / 86400.0)::float AS avg
    FROM (
      SELECT subscriber_id, MIN(sent_at) AS first_sent
      FROM api.lead_content_sent
      WHERE tenant_id = ${tenantId}
      GROUP BY subscriber_id
    ) lcs
    JOIN (
      SELECT subscriber_id, MIN(created_at) AS first_transition
      FROM api.stage_transitions
      WHERE tenant_id = ${tenantId} AND to_stage = 'B'
      GROUP BY subscriber_id
    ) st ON st.subscriber_id = lcs.subscriber_id
    JOIN api.subscribers s ON s.id = lcs.subscriber_id
    WHERE s.first_seen_at >= ${start.toISOString()}::timestamptz AND s.first_seen_at < ${end.toISOString()}::timestamptz
  `);
  const msToB = (msToBRow[0] as AvgRow)?.avg ?? null;

  async function avgBetween(fromStage: string, toStage: string): Promise<number | null> {
    const r = await db.execute(sql`
      SELECT AVG(EXTRACT(EPOCH FROM (t2.created_at - t1.created_at)) / 86400.0)::float AS avg
      FROM api.stage_transitions t1
      JOIN api.stage_transitions t2
        ON t2.subscriber_id = t1.subscriber_id
       AND t2.to_stage = ${toStage}
       AND t2.created_at > t1.created_at
       AND t2.tenant_id = ${tenantId}
      JOIN api.subscribers s ON s.id = t1.subscriber_id
      WHERE t1.tenant_id = ${tenantId}
        AND t1.to_stage = ${fromStage}
        AND s.first_seen_at >= ${start.toISOString()}::timestamptz AND s.first_seen_at < ${end.toISOString()}::timestamptz
    `);
    return (r[0] as AvgRow)?.avg ?? null;
  }

  const [bToC, cToD] = await Promise.all([avgBetween('B', 'C'), avgBetween('C', 'D')]);

  const parts = [aToMs, msToB, bToC, cToD];
  const aToD = parts.every((p) => p != null) ? parts.reduce((s, p) => s + (p as number), 0) : null;

  return { aToMs, msToB, bToC, cToD, aToD };
}

export type TopFastLead = {
  igUsername: string | null;
  daysToD: number;
};

export async function getTopFastest(args: {
  tenantId: string;
  limit?: number;
}): Promise<TopFastLead[]> {
  const limit = args.limit ?? 5;
  const rows = await db.execute(sql`
    SELECT s.ig_username,
           EXTRACT(EPOCH FROM (MIN(st.created_at) - s.first_seen_at)) / 86400.0 AS days_to_d
    FROM api.subscribers s
    JOIN api.stage_transitions st
      ON st.subscriber_id = s.id
     AND st.to_stage = 'D'
     AND st.tenant_id = s.tenant_id
    WHERE s.tenant_id = ${args.tenantId}
    GROUP BY s.id, s.ig_username, s.first_seen_at
    ORDER BY days_to_d ASC
    LIMIT ${limit}
  `);
  return (rows as unknown as Array<{ ig_username: string | null; days_to_d: number }>).map((r) => ({
    igUsername: r.ig_username,
    daysToD: Math.round(r.days_to_d * 10) / 10,
  }));
}
