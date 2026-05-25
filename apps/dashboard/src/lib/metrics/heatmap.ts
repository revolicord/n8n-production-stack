import { db, subscribers } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { and, eq, gte, lt } from 'drizzle-orm';

export type HeatmapDay = { day: string; count: number };

export async function getMonthlyHeatmap(args: {
  tenantId: string;
  start: Date;
  end: Date;
}): Promise<HeatmapDay[]> {
  const rows = await db
    .select({
      day: sql<string>`TO_CHAR(first_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(subscribers)
    .where(
      and(
        eq(subscribers.tenantId, args.tenantId),
        gte(subscribers.firstSeenAt, args.start),
        lt(subscribers.firstSeenAt, args.end),
      ),
    )
    .groupBy(sql`TO_CHAR(first_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')`)
    .orderBy(sql`TO_CHAR(first_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')`);

  return rows;
}

export function levelFor(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0;
  const ratio = count / Math.max(max, 1);
  if (ratio < 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio < 0.75) return 3;
  return 4;
}
