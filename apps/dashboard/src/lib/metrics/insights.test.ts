import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ db: {} }));

import type { ActiveByStage, FunnelView } from './funnel';
import { buildInsights } from './insights';
import type { MonthlySeries } from './timeseries';
import type { Velocity } from './velocity';

function makeFunnelView(counts = { a: 100, ms: 80, b: 60, c: 40, d: 20 }): FunnelView {
  return {
    counts,
    ratios: {
      msr: counts.a > 0 ? counts.ms / counts.a : null,
      prr: counts.a > 0 ? counts.b / counts.a : null,
      csr: counts.a > 0 ? counts.c / counts.a : null,
      abr: counts.a > 0 ? counts.d / counts.a : null,
      aToMs: counts.a > 0 ? counts.ms / counts.a : null,
      msToB: counts.ms > 0 ? counts.b / counts.ms : null,
      bToC: counts.b > 0 ? counts.c / counts.b : null,
      cToD: counts.c > 0 ? counts.d / counts.c : null,
    },
    drops: {
      aToMs: { lost: counts.a - counts.ms, pct: counts.a > 0 ? 1 - counts.ms / counts.a : null },
      msToB: { lost: counts.ms - counts.b, pct: counts.ms > 0 ? 1 - counts.b / counts.ms : null },
      bToC: { lost: counts.b - counts.c, pct: counts.b > 0 ? 1 - counts.c / counts.b : null },
      cToD: { lost: counts.c - counts.d, pct: counts.c > 0 ? 1 - counts.d / counts.c : null },
    },
  };
}

function makeSeriesWithAvgRatios(avgBToC: number | null, avgMsr: number | null): MonthlySeries {
  return {
    year: 2026,
    months: [],
    totals: { a: 0, ms: 0, b: 0, c: 0, d: 0 },
    avgRatios: {
      msr: avgMsr,
      prr: null,
      csr: null,
      abr: null,
      aToMs: null,
      msToB: null,
      bToC: avgBToC,
      cToD: null,
    },
  };
}

const defaultVelocity: Velocity = { aToMs: 2, msToB: 1, bToC: 1, cToD: 0.5, aToD: 4.5 };
const defaultActive: ActiveByStage = { a: 10, ms: 8, b: 5, c: 3, d: 1 };

describe('buildInsights rule 1: B→C bottleneck', () => {
  it('fires when current bToC < 90% of historical', () => {
    const series = makeSeriesWithAvgRatios(0.8, null);
    const current = makeFunnelView({ a: 100, ms: 80, b: 60, c: 30, d: 15 }); // bToC = 0.5
    const insights = buildInsights({
      current,
      yearSeries: series,
      velocity: defaultVelocity,
      active: defaultActive,
    });
    expect(insights.some((i) => i.iconName === 'IconAlertTriangle')).toBe(true);
  });

  it('does not fire when bToC is within range', () => {
    const series = makeSeriesWithAvgRatios(0.7, null);
    const current = makeFunnelView({ a: 100, ms: 80, b: 60, c: 40, d: 20 }); // bToC = 0.667
    const insights = buildInsights({
      current,
      yearSeries: series,
      velocity: defaultVelocity,
      active: defaultActive,
    });
    expect(insights.some((i) => i.iconName === 'IconAlertTriangle')).toBe(false);
  });

  it('does not fire when yearSeries is null', () => {
    const current = makeFunnelView({ a: 100, ms: 80, b: 60, c: 10, d: 5 });
    const insights = buildInsights({
      current,
      yearSeries: null,
      velocity: defaultVelocity,
      active: defaultActive,
    });
    expect(insights.some((i) => i.iconName === 'IconAlertTriangle')).toBe(false);
  });
});

describe('buildInsights rule 3: stale B prospects', () => {
  it('fires when staleBCount >= 10', () => {
    const current = makeFunnelView();
    const insights = buildInsights({
      current,
      yearSeries: null,
      velocity: defaultVelocity,
      active: defaultActive,
      staleBCount: 12,
    });
    expect(insights.some((i) => i.iconName === 'IconTarget')).toBe(true);
  });

  it('does not fire when staleBCount < 10', () => {
    const current = makeFunnelView();
    const insights = buildInsights({
      current,
      yearSeries: null,
      velocity: defaultVelocity,
      active: defaultActive,
      staleBCount: 5,
    });
    expect(insights.some((i) => i.iconName === 'IconTarget')).toBe(false);
  });
});

describe('buildInsights rule 4: velocity', () => {
  it('fires when aToD < 7 days', () => {
    const current = makeFunnelView();
    const fastVelocity: Velocity = { aToMs: 1, msToB: 1, bToC: 1, cToD: 1, aToD: 5.0 };
    const insights = buildInsights({
      current,
      yearSeries: null,
      velocity: fastVelocity,
      active: defaultActive,
    });
    expect(insights.some((i) => i.iconName === 'IconClockHour4')).toBe(true);
  });

  it('does not fire when aToD >= 7 days', () => {
    const current = makeFunnelView();
    const slowVelocity: Velocity = { aToMs: 3, msToB: 2, bToC: 2, cToD: 1, aToD: 8.5 };
    const insights = buildInsights({
      current,
      yearSeries: null,
      velocity: slowVelocity,
      active: defaultActive,
    });
    expect(insights.some((i) => i.iconName === 'IconClockHour4')).toBe(false);
  });
});
