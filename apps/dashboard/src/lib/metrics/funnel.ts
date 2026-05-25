import { db, leadContentSent, leadStages, stageTransitions, subscribers } from '@/lib/db';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { safeDivide } from './_helpers';

export type FunnelCounts = {
  a: number;
  ms: number;
  b: number;
  c: number;
  d: number;
};

export type FunnelRatios = {
  msr: number | null;
  prr: number | null;
  csr: number | null;
  abr: number | null;
  aToMs: number | null;
  msToB: number | null;
  bToC: number | null;
  cToD: number | null;
};

export type FunnelView = {
  counts: FunnelCounts;
  ratios: FunnelRatios;
  drops: {
    aToMs: { lost: number; pct: number | null };
    msToB: { lost: number; pct: number | null };
    bToC: { lost: number; pct: number | null };
    cToD: { lost: number; pct: number | null };
  };
};

export type ActiveByStage = {
  a: number;
  ms: number;
  b: number;
  c: number;
  d: number;
};

export async function getFunnelCounts(args: {
  tenantId: string;
  start: Date;
  end: Date;
}): Promise<FunnelCounts> {
  const { tenantId, start, end } = args;

  const [aRow] = await db
    .select({ value: sql<number>`COUNT(*)::int` })
    .from(subscribers)
    .where(
      and(
        eq(subscribers.tenantId, tenantId),
        gte(subscribers.firstSeenAt, start),
        lt(subscribers.firstSeenAt, end),
      ),
    );

  const [msRow] = await db
    .select({ value: sql<number>`COUNT(DISTINCT subscriber_id)::int` })
    .from(leadContentSent)
    .where(
      and(
        eq(leadContentSent.tenantId, tenantId),
        gte(leadContentSent.sentAt, start),
        lt(leadContentSent.sentAt, end),
      ),
    );

  async function transitionsTo(toStage: string) {
    const [row] = await db
      .select({ value: sql<number>`COUNT(DISTINCT subscriber_id)::int` })
      .from(stageTransitions)
      .where(
        and(
          eq(stageTransitions.tenantId, tenantId),
          eq(stageTransitions.toStage, toStage),
          gte(stageTransitions.createdAt, start),
          lt(stageTransitions.createdAt, end),
        ),
      );
    return row?.value ?? 0;
  }

  const [b, c, d] = await Promise.all([transitionsTo('B'), transitionsTo('C'), transitionsTo('D')]);

  return {
    a: aRow?.value ?? 0,
    ms: msRow?.value ?? 0,
    b,
    c,
    d,
  };
}

export function ratiosFromCounts(c: FunnelCounts): FunnelRatios {
  return {
    msr: safeDivide(c.ms, c.a),
    prr: safeDivide(c.b, c.a),
    csr: safeDivide(c.c, c.a),
    abr: safeDivide(c.d, c.a),
    aToMs: safeDivide(c.ms, c.a),
    msToB: safeDivide(c.b, c.ms),
    bToC: safeDivide(c.c, c.b),
    cToD: safeDivide(c.d, c.c),
  };
}

export async function getFunnelView(args: {
  tenantId: string;
  start: Date;
  end: Date;
}): Promise<FunnelView> {
  const counts = await getFunnelCounts(args);
  const ratios = ratiosFromCounts(counts);

  const drops = {
    aToMs: {
      lost: counts.a - counts.ms,
      pct: ratios.aToMs == null ? null : 1 - ratios.aToMs,
    },
    msToB: {
      lost: counts.ms - counts.b,
      pct: ratios.msToB == null ? null : 1 - ratios.msToB,
    },
    bToC: {
      lost: counts.b - counts.c,
      pct: ratios.bToC == null ? null : 1 - ratios.bToC,
    },
    cToD: {
      lost: counts.c - counts.d,
      pct: ratios.cToD == null ? null : 1 - ratios.cToD,
    },
  };

  return { counts, ratios, drops };
}

export async function getActiveByStage(args: {
  tenantId: string;
}): Promise<ActiveByStage> {
  const rows = await db
    .select({
      stage: leadStages.currentStage,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(leadStages)
    .where(eq(leadStages.tenantId, args.tenantId))
    .groupBy(leadStages.currentStage);

  const counts: ActiveByStage = { a: 0, ms: 0, b: 0, c: 0, d: 0 };
  for (const r of rows) {
    const key = (r.stage as string).toLowerCase() as keyof ActiveByStage;
    if (key in counts) counts[key] = r.count;
  }
  return counts;
}
