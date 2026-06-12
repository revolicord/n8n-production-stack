import { describe, expect, it } from 'vitest';
import { collapseVariantGroups, pickWeighted } from '../core/context/weighted.js';

describe('pickWeighted', () => {
  it('returns null for empty array', () => {
    expect(pickWeighted([], () => 0)).toBeNull();
  });

  it('returns the only element', () => {
    const result = pickWeighted([{ item: 'a', weight: 1 }], () => 0.5);
    expect(result).toBe('a');
  });

  it('respects weights with fixed RNG', () => {
    const items = [
      { item: 'a', weight: 1 },
      { item: 'b', weight: 9 },
    ];
    // rng=0.05 => rand=0.5 out of 10 => first item (a has weight 1, so rand <= 0 after subtracting 1 when rand=0.05)
    const result = pickWeighted(items, () => 0.05);
    expect(result).toBe('a');
  });

  it('treats null/undefined weight as 1', () => {
    const items = [
      { item: 'a', weight: null as unknown as number },
      { item: 'b', weight: undefined as unknown as number },
    ];
    // Both weight=1, total=2; rng=0.4 => rand=0.8; 0.8 - 1 = -0.2 <= 0 => 'a'
    const result = pickWeighted(items, () => 0.4);
    expect(result).toBe('a');
  });
});

describe('collapseVariantGroups (bug v5 regression)', () => {
  it('singleton passes through with correct sent count', () => {
    const variants = [{ flowNs: 'ns_a', slugId: 'slug_a', variantGroup: null, weight: 1 }];
    const sentMap = new Map([['slug_a', { slugId: 'slug_a', sentAt: new Date('2024-01-01') }]]);
    const result = collapseVariantGroups(variants, sentMap, () => 0.5);
    expect(result).toHaveLength(1);
    expect(result[0]?.timesSent).toBe(1);
    expect(result[0]?.lastSent).toEqual(new Date('2024-01-01'));
  });

  it('group with v1/v2, sentMap only has v2 — reports timesSent:1 from v2', () => {
    const variants = [
      { flowNs: 'ns_v1', slugId: 'slug_v1', variantGroup: 'grp_a', weight: 1 },
      { flowNs: 'ns_v2', slugId: 'slug_v2', variantGroup: 'grp_a', weight: 1 },
    ];
    // Only v2 was sent
    const sentMap = new Map([['slug_v2', { slugId: 'slug_v2', sentAt: new Date('2024-02-01') }]]);
    // Force pick v1 (rng returns low value)
    const result = collapseVariantGroups(variants, sentMap, () => 0.01);
    expect(result).toHaveLength(1);
    // timesSent should be 1 (v2 was sent, v1 was not)
    expect(result[0]?.timesSent).toBe(1);
    expect(result[0]?.lastSent).toEqual(new Date('2024-02-01'));
  });

  it('empty sentMap gives timesSent:0', () => {
    const variants = [{ flowNs: 'ns_a', slugId: 'slug_a', variantGroup: null, weight: 1 }];
    const result = collapseVariantGroups(variants, new Map(), () => 0.5);
    expect(result[0]?.timesSent).toBe(0);
    expect(result[0]?.lastSent).toBeNull();
  });

  it('group of 1 variant degrades gracefully (Bufete case)', () => {
    const variants = [{ flowNs: 'ns_only', slugId: 'slug_only', variantGroup: 'grp_x', weight: 1 }];
    const result = collapseVariantGroups(variants, new Map(), () => 0.5);
    expect(result).toHaveLength(1);
    expect(result[0]?.flowNs).toBe('ns_only');
  });
});
