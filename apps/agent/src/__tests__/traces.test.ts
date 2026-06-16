import { describe, expect, it } from 'vitest';
import { resolveTraceMode } from '../services/traces.js';

describe('resolveTraceMode (ADR-0025)', () => {
  it('usa run_mode explícito si está presente', () => {
    expect(resolveTraceMode({ dry_run: true, run_mode: 'replay' })).toBe('replay');
    expect(resolveTraceMode({ dry_run: false, run_mode: 'shadow' })).toBe('shadow');
  });

  it('infiere de dry_run cuando no hay run_mode', () => {
    expect(resolveTraceMode({ dry_run: false })).toBe('live');
    expect(resolveTraceMode({ dry_run: true })).toBe('shadow');
  });
});
