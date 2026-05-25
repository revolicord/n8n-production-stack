import { type FunnelCounts, type FunnelRatios, getFunnelCounts, ratiosFromCounts } from './funnel';

export type MonthlySeries = {
  year: number;
  months: Array<{
    month: number;
    counts: FunnelCounts;
    ratios: FunnelRatios;
  }>;
  totals: FunnelCounts;
  avgRatios: FunnelRatios;
};

export async function getMonthlySeries(args: {
  tenantId: string;
  year: number;
}): Promise<MonthlySeries> {
  const { tenantId, year } = args;

  const months = await Promise.all(
    Array.from({ length: 12 }, async (_, i) => {
      const month = i + 1;
      const start = new Date(Date.UTC(year, i, 1));
      const end = new Date(Date.UTC(year, i + 1, 1));
      const counts = await getFunnelCounts({ tenantId, start, end });
      const ratios = ratiosFromCounts(counts);
      return { month, counts, ratios };
    }),
  );

  const totals: FunnelCounts = months.reduce(
    (acc, m) => ({
      a: acc.a + m.counts.a,
      ms: acc.ms + m.counts.ms,
      b: acc.b + m.counts.b,
      c: acc.c + m.counts.c,
      d: acc.d + m.counts.d,
    }),
    { a: 0, ms: 0, b: 0, c: 0, d: 0 },
  );

  function avgOf(getter: (r: FunnelRatios) => number | null): number | null {
    const valid = months.map((m) => getter(m.ratios)).filter((v): v is number => v != null);
    if (valid.length === 0) return null;
    return valid.reduce((s, v) => s + v, 0) / valid.length;
  }

  const avgRatios: FunnelRatios = {
    msr: avgOf((r) => r.msr),
    prr: avgOf((r) => r.prr),
    csr: avgOf((r) => r.csr),
    abr: avgOf((r) => r.abr),
    aToMs: avgOf((r) => r.aToMs),
    msToB: avgOf((r) => r.msToB),
    bToC: avgOf((r) => r.bToC),
    cToD: avgOf((r) => r.cToD),
  };

  return { year, months, totals, avgRatios };
}
