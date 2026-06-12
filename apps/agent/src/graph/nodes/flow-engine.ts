import type { DialogueCommand } from '@dm-api/shared';
import type { AssembledContext } from '../../core/context/assemble.js';
import { type FlowEngineResult, advanceDialogue } from '../../core/flow-engine/engine.js';
import type { GraphState } from '../annotation.js';

export function flowEngineNode(
  _state: GraphState,
  ctx: AssembledContext,
  commands: DialogueCommand[],
): FlowEngineResult {
  const transitions = ctx.transitions.map((t) => ({
    fromStageSlug: t.fromStageSlug,
    toStageSlug: t.toStageSlug,
    whenToUse: t.whenToUse,
  }));

  return advanceDialogue({
    state: ctx.dialogueState,
    commands,
    flows: ctx.activeFlows,
    transitions,
    currentStage: ctx.currentStage,
    now: new Date().toISOString(),
  });
}
