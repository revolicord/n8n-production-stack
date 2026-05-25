import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./funnel', () => ({
  getFunnelCounts: vi.fn(),
}));

import { getFunnelCounts } from './funnel';
import { getMonthPrediction } from './prediction';

const mockGetFunnelCounts = vi.mocked(getFunnelCounts);

describe('getMonthPrediction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('projects linearly based on days elapsed', async () => {
    // 10 days into May, 10 bookings → rate = 1/day → projected = 31
    mockGetFunnelCounts
      .mockResolvedValueOnce({ a: 100, ms: 80, b: 60, c: 40, d: 10 }) // current month
      .mockResolvedValueOnce({ a: 80, ms: 60, b: 40, c: 20, d: 8 }); // previous month

    const now = new Date(Date.UTC(2026, 4, 10)); // May 10
    const result = await getMonthPrediction({
      tenantId: 'tenant-1',
      year: 2026,
      month: 5,
      now,
    });

    expect(result.current).toBe(10);
    expect(result.daysElapsed).toBe(10);
    expect(result.daysInMonth).toBe(31);
    expect(result.rate).toBeCloseTo(1.0);
    expect(result.projected).toBe(31);
  });

  it('returns pct null when previous month has zero bookings', async () => {
    mockGetFunnelCounts
      .mockResolvedValueOnce({ a: 50, ms: 40, b: 30, c: 15, d: 5 })
      .mockResolvedValueOnce({ a: 30, ms: 20, b: 10, c: 5, d: 0 });

    const now = new Date(Date.UTC(2026, 4, 5));
    const result = await getMonthPrediction({
      tenantId: 'tenant-1',
      year: 2026,
      month: 5,
      now,
    });

    expect(result.comparison.pct).toBeNull();
    expect(result.comparison.vsLastMonth).toBe(result.projected - 0);
  });

  it('handles January correctly (prev month = December prev year)', async () => {
    mockGetFunnelCounts
      .mockResolvedValueOnce({ a: 10, ms: 8, b: 5, c: 3, d: 2 })
      .mockResolvedValueOnce({ a: 20, ms: 15, b: 10, c: 5, d: 4 });

    const now = new Date(Date.UTC(2026, 0, 15));
    const result = await getMonthPrediction({
      tenantId: 'tenant-1',
      year: 2026,
      month: 1,
      now,
    });

    expect(result.daysInMonth).toBe(31);
    expect(result.current).toBe(2);
    expect(result.comparison.vsLastMonth).toBe(result.projected - 4);
  });

  it('does not project beyond 1 day elapsed', async () => {
    mockGetFunnelCounts
      .mockResolvedValueOnce({ a: 5, ms: 3, b: 2, c: 1, d: 1 })
      .mockResolvedValueOnce({ a: 5, ms: 3, b: 2, c: 1, d: 2 });

    const now = new Date(Date.UTC(2026, 4, 1));
    const result = await getMonthPrediction({
      tenantId: 'tenant-1',
      year: 2026,
      month: 5,
      now,
    });

    expect(result.daysElapsed).toBe(1);
    expect(result.rate).toBe(1);
    expect(result.projected).toBe(31);
  });
});
