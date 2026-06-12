import type { Condition } from '@dm-api/shared';
import type { SlotValue } from '@dm-api/shared';

function getNestedValue(slots: Record<string, SlotValue>, path: string): SlotValue | undefined {
  const parts = path.split('.');
  let current: unknown = slots;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current as SlotValue | undefined;
}

export function evaluateCondition(condition: Condition, slots: Record<string, SlotValue>): boolean {
  const val = getNestedValue(slots, condition.slot);

  switch (condition.op) {
    case 'exists':
      return val != null;
    case 'not_exists':
      return val == null;
    case 'eq':
      return val === condition.value;
    case 'neq':
      return val !== condition.value;
    case 'in': {
      if (!Array.isArray(condition.value)) return false;
      return condition.value.includes(val as SlotValue);
    }
    case 'gte':
      return typeof val === 'number' && typeof condition.value === 'number'
        ? val >= condition.value
        : false;
    case 'lte':
      return typeof val === 'number' && typeof condition.value === 'number'
        ? val <= condition.value
        : false;
  }
}
