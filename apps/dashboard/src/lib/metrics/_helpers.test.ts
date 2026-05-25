import { describe, expect, it } from 'vitest';
import { getPeriodRange, safeDivide } from './_helpers';

describe('safeDivide', () => {
  it('divides normally', () => {
    expect(safeDivide(10, 4)).toBe(2.5);
  });

  it('returns null for zero denominator', () => {
    expect(safeDivide(5, 0)).toBeNull();
  });

  it('returns null for falsy denominator', () => {
    expect(safeDivide(5, 0)).toBeNull();
  });

  it('handles 0 numerator', () => {
    expect(safeDivide(0, 10)).toBe(0);
  });
});

describe('getPeriodRange', () => {
  it('returns full year for year-only', () => {
    const { start, end } = getPeriodRange(2026);
    expect(start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('returns month range for year+month', () => {
    const { start, end } = getPeriodRange(2026, 3);
    expect(start.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('handles December correctly', () => {
    const { start, end } = getPeriodRange(2026, 12);
    expect(start.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});
