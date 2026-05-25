import { describe, expect, it } from 'vitest';
import { levelFor } from './heatmap';

describe('levelFor', () => {
  it('returns 0 for zero count', () => {
    expect(levelFor(0, 10)).toBe(0);
  });

  it('returns 0 for zero count regardless of max', () => {
    expect(levelFor(0, 0)).toBe(0);
  });

  it('returns 1 for low activity (< 25% of max)', () => {
    expect(levelFor(2, 10)).toBe(1);
    expect(levelFor(1, 5)).toBe(1);
  });

  it('returns 2 for medium-low activity (25-50%)', () => {
    expect(levelFor(3, 10)).toBe(2);
    expect(levelFor(5, 10)).toBe(2);
  });

  it('returns 3 for medium-high activity (50-75%)', () => {
    expect(levelFor(6, 10)).toBe(3);
    expect(levelFor(7, 10)).toBe(3);
  });

  it('returns 4 for high activity (>= 75%)', () => {
    expect(levelFor(8, 10)).toBe(4);
    expect(levelFor(10, 10)).toBe(4);
  });

  it('uses max=1 when max is 0 to avoid division by zero', () => {
    expect(levelFor(1, 0)).toBe(4);
  });
});
