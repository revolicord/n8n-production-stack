import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {},
  subscribers: {},
  stageTransitions: {},
  leadContentSent: {},
  leadStages: {},
}));

import { ratiosFromCounts } from './funnel';
import type { FunnelCounts } from './funnel';

describe('ratiosFromCounts', () => {
  it('computes all ratios with normal counts', () => {
    const c: FunnelCounts = { a: 100, ms: 80, b: 60, c: 40, d: 20 };
    const r = ratiosFromCounts(c);
    expect(r.msr).toBeCloseTo(0.8);
    expect(r.prr).toBeCloseTo(0.6);
    expect(r.csr).toBeCloseTo(0.4);
    expect(r.abr).toBeCloseTo(0.2);
    expect(r.aToMs).toBeCloseTo(0.8);
    expect(r.msToB).toBeCloseTo(0.75);
    expect(r.bToC).toBeCloseTo(0.6667, 4);
    expect(r.cToD).toBeCloseTo(0.5);
  });

  it('returns null for ratios with zero denominator', () => {
    const c: FunnelCounts = { a: 0, ms: 0, b: 0, c: 0, d: 0 };
    const r = ratiosFromCounts(c);
    expect(r.msr).toBeNull();
    expect(r.prr).toBeNull();
    expect(r.csr).toBeNull();
    expect(r.abr).toBeNull();
    expect(r.aToMs).toBeNull();
    expect(r.msToB).toBeNull();
    expect(r.bToC).toBeNull();
    expect(r.cToD).toBeNull();
  });

  it('returns null for individual stage when denominator is zero', () => {
    const c: FunnelCounts = { a: 10, ms: 5, b: 0, c: 0, d: 0 };
    const r = ratiosFromCounts(c);
    expect(r.msr).toBeCloseTo(0.5);
    expect(r.aToMs).toBeCloseTo(0.5);
    expect(r.msToB).toBeCloseTo(0);
    expect(r.bToC).toBeNull();
    expect(r.cToD).toBeNull();
  });

  it('handles partial funnel with non-zero early stages only', () => {
    const c: FunnelCounts = { a: 50, ms: 30, b: 10, c: 0, d: 0 };
    const r = ratiosFromCounts(c);
    expect(r.bToC).toBeCloseTo(0);
    expect(r.cToD).toBeNull();
  });

  it('handles perfect funnel (no drops)', () => {
    const c: FunnelCounts = { a: 10, ms: 10, b: 10, c: 10, d: 10 };
    const r = ratiosFromCounts(c);
    expect(r.msr).toBeCloseTo(1);
    expect(r.abr).toBeCloseTo(1);
    expect(r.cToD).toBeCloseTo(1);
  });
});
