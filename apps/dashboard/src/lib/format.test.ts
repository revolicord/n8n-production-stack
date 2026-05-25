import { describe, expect, it } from 'vitest';
import { fmtDays, fmtDelta, fmtNumber, fmtPct } from './format';

describe('fmtPct', () => {
  it('formats a fraction as percentage', () => {
    expect(fmtPct(0.432)).toBe('43%');
  });

  it('returns — for null', () => {
    expect(fmtPct(null)).toBe('—');
  });

  it('respects decimals', () => {
    expect(fmtPct(0.056, 1)).toBe('5.6%');
  });

  it('handles 0 correctly', () => {
    expect(fmtPct(0)).toBe('0%');
  });

  it('handles 1 (100%)', () => {
    expect(fmtPct(1)).toBe('100%');
  });
});

describe('fmtNumber', () => {
  it('returns a string representation of the number', () => {
    expect(typeof fmtNumber(1000)).toBe('string');
    expect(fmtNumber(1000)).toMatch(/1[\s.,]?000|1000/);
  });

  it('handles 0', () => {
    expect(fmtNumber(0)).toBe('0');
  });
});

describe('fmtDays', () => {
  it('formats a float', () => {
    expect(fmtDays(3.5)).toBe('3.5 días');
  });

  it('returns — for null', () => {
    expect(fmtDays(null)).toBe('—');
  });
});

describe('fmtDelta', () => {
  it('adds + sign for positive', () => {
    expect(fmtDelta(12)).toBe('+12%');
  });

  it('no extra sign for negative', () => {
    expect(fmtDelta(-5)).toBe('-5%');
  });
});
