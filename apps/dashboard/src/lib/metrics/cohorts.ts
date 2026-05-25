import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

export type CohortRow = {
  cohortWeek: string;
  total: number;
  reachedMs: number;
  reachedB: number;
  reachedC: number;
  reachedD: number;
};

export async function getCohorts(args: {
  tenantId: string;
  start: Date;
  end: Date;
}): Promise<CohortRow[]> {
  const { tenantId, start, end } = args;
  const rows = await db.execute(sql`
    WITH cohort_weeks AS (
      SELECT
        id,
        TO_CHAR(DATE_TRUNC('week', first_seen_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS cohort_week
      FROM api.subscribers
      WHERE tenant_id = ${tenantId}
        AND first_seen_at >= ${start.toISOString()}::timestamptz
        AND first_seen_at <  ${end.toISOString()}::timestamptz
    )
    SELECT
      cw.cohort_week,
      COUNT(*)::int                                                                             AS total,
      COUNT(DISTINCT lcs.subscriber_id)::int                                                   AS reached_ms,
      COUNT(DISTINCT stb.subscriber_id)::int                                                   AS reached_b,
      COUNT(DISTINCT stc.subscriber_id)::int                                                   AS reached_c,
      COUNT(DISTINCT std.subscriber_id)::int                                                   AS reached_d
    FROM cohort_weeks cw
    LEFT JOIN (
      SELECT DISTINCT subscriber_id
      FROM api.lead_content_sent
      WHERE tenant_id = ${tenantId}
    ) lcs ON lcs.subscriber_id = cw.id
    LEFT JOIN (
      SELECT DISTINCT subscriber_id
      FROM api.stage_transitions
      WHERE tenant_id = ${tenantId} AND to_stage = 'B'
    ) stb ON stb.subscriber_id = cw.id
    LEFT JOIN (
      SELECT DISTINCT subscriber_id
      FROM api.stage_transitions
      WHERE tenant_id = ${tenantId} AND to_stage = 'C'
    ) stc ON stc.subscriber_id = cw.id
    LEFT JOIN (
      SELECT DISTINCT subscriber_id
      FROM api.stage_transitions
      WHERE tenant_id = ${tenantId} AND to_stage = 'D'
    ) std ON std.subscriber_id = cw.id
    GROUP BY cw.cohort_week
    ORDER BY cw.cohort_week
  `);

  return (
    rows as unknown as Array<{
      cohort_week: string;
      total: number;
      reached_ms: number;
      reached_b: number;
      reached_c: number;
      reached_d: number;
    }>
  ).map((r) => ({
    cohortWeek: r.cohort_week,
    total: r.total,
    reachedMs: r.reached_ms,
    reachedB: r.reached_b,
    reachedC: r.reached_c,
    reachedD: r.reached_d,
  }));
}
