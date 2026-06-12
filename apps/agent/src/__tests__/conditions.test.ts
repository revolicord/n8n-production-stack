import { describe, expect, it } from 'vitest';
import { evaluateCondition } from '../core/flow-engine/conditions.js';

describe('evaluateCondition', () => {
  const slots = {
    name: 'Alice',
    age: 30,
    active: true,
    score: null as unknown as import('@dm-api/shared').SlotValue,
    nested: { has_conflict: true } as unknown as import('@dm-api/shared').SlotValue,
  };

  it('eq matches string', () => {
    expect(evaluateCondition({ slot: 'name', op: 'eq', value: 'Alice' }, slots)).toBe(true);
    expect(evaluateCondition({ slot: 'name', op: 'eq', value: 'Bob' }, slots)).toBe(false);
  });

  it('neq works', () => {
    expect(evaluateCondition({ slot: 'name', op: 'neq', value: 'Bob' }, slots)).toBe(true);
  });

  it('exists / not_exists', () => {
    expect(evaluateCondition({ slot: 'name', op: 'exists' }, slots)).toBe(true);
    expect(evaluateCondition({ slot: 'missing', op: 'exists' }, slots)).toBe(false);
    expect(evaluateCondition({ slot: 'missing', op: 'not_exists' }, slots)).toBe(true);
  });

  it('in array', () => {
    expect(evaluateCondition({ slot: 'name', op: 'in', value: ['Alice', 'Bob'] }, slots)).toBe(
      true,
    );
    expect(evaluateCondition({ slot: 'name', op: 'in', value: ['Bob', 'Charlie'] }, slots)).toBe(
      false,
    );
  });

  it('gte / lte', () => {
    expect(evaluateCondition({ slot: 'age', op: 'gte', value: 25 }, slots)).toBe(true);
    expect(evaluateCondition({ slot: 'age', op: 'gte', value: 35 }, slots)).toBe(false);
    expect(evaluateCondition({ slot: 'age', op: 'lte', value: 35 }, slots)).toBe(true);
  });

  it('dot-path into nested object', () => {
    expect(
      evaluateCondition(
        { slot: 'nested.has_conflict', op: 'eq', value: true },
        slots as Record<string, import('@dm-api/shared').SlotValue>,
      ),
    ).toBe(true);
  });
});
