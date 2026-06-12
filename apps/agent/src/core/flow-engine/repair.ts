import type { DialogueState, RepairPattern } from '@dm-api/shared';

export function setRepairContext(
  state: DialogueState,
  pattern: RepairPattern,
  payload: Record<string, unknown>,
  now: string,
): DialogueState {
  return {
    ...state,
    repair_context: { pattern, since: now, payload },
  };
}

export function clearRepairContext(state: DialogueState): DialogueState {
  return { ...state, repair_context: null };
}
