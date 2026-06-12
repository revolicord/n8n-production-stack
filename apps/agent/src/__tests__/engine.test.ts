import type { DialogueState, FlowDefinition } from '@dm-api/shared';
import { describe, expect, it } from 'vitest';
import { advanceDialogue } from '../core/flow-engine/engine.js';
import type { FlowEngineInput } from '../core/flow-engine/engine.js';

const EMPTY_STATE: DialogueState = {
  version: 1,
  stack: [],
  slots: {},
  repair_context: null,
  last_turn_id: null,
};

const NOW = '2024-01-01T00:00:00.000Z';

function makeFlow(
  id: string,
  steps: FlowDefinition['steps'],
): { version: number; def: FlowDefinition } {
  return {
    version: 1,
    def: {
      flow_id: id,
      name: id,
      trigger: { type: 'system' },
      slots: [],
      steps,
    },
  };
}

describe('advanceDialogue — StartFlow + collect + branch', () => {
  const flows = new Map([
    [
      'intake',
      makeFlow('intake', [
        {
          id: 's1',
          type: 'collect',
          slot: 'name',
          prompt_hint: 'Ask for name',
          validation: 'text',
          skip_if_filled: true,
        },
        {
          id: 's2',
          type: 'action',
          action: 'reply_text',
          config: { text: 'Got it!' },
          on_failure: 'abort',
        },
      ]),
    ],
  ]);

  it('StartFlow → collect pauses on first step', () => {
    const input: FlowEngineInput = {
      state: EMPTY_STATE,
      commands: [{ type: 'StartFlow', flow_id: 'intake', inputs: {}, evidence: 'test' }],
      flows,
      transitions: [],
      currentStage: 'A',
      now: NOW,
    };
    const result = advanceDialogue(input);
    expect(result.pendingCollect).not.toBeNull();
    expect(result.pendingCollect?.slot).toBe('name');
    expect(result.interrupt).toBeNull();
    expect(result.state.stack).toHaveLength(1);
  });

  it('slot already filled → skips collect, runs action', () => {
    const stateWithName: DialogueState = { ...EMPTY_STATE, slots: { name: 'Alice' } };
    const input: FlowEngineInput = {
      state: stateWithName,
      commands: [{ type: 'StartFlow', flow_id: 'intake', inputs: {}, evidence: 'test' }],
      flows,
      transitions: [],
      currentStage: 'A',
      now: NOW,
    };
    const result = advanceDialogue(input);
    expect(result.pendingCollect).toBeNull();
    expect(result.invocations).toHaveLength(1);
    expect(result.invocations[0]?.action).toBe('reply_text');
    expect(result.state.stack).toHaveLength(0); // flow completed and popped
  });
});

describe('advanceDialogue — ChangeStage with cascade', () => {
  const cascadeFlow = makeFlow('cascade_a_ms', [
    {
      id: 's1',
      type: 'action',
      action: 'send_content',
      config: { slug_id: 'audio_slug' },
      on_failure: 'abort',
    },
    {
      id: 's2',
      type: 'action',
      action: 'send_content',
      config: { slug_id: 'vsl_slug' },
      on_failure: 'abort',
    },
  ]);
  cascadeFlow.def.trigger = { type: 'stage_transition', from: 'A', to: 'MS' };

  const flows = new Map([['cascade_a_ms', cascadeFlow]]);
  const transitions = [
    { fromStageSlug: 'A', toStageSlug: 'MS', whenToUse: 'when positive signal' },
  ];

  it('ChangeStage A→MS pushes cascade flow and runs steps', () => {
    const input: FlowEngineInput = {
      state: EMPTY_STATE,
      commands: [
        {
          type: 'ChangeStage',
          to_stage: 'MS',
          reason: null,
          evidence: 'test',
          cascade: true,
        },
      ],
      flows,
      transitions,
      currentStage: 'A',
      now: NOW,
    };
    const result = advanceDialogue(input);
    // Should have change_stage invocation + 2 send_content invocations
    expect(result.invocations).toHaveLength(3);
    expect(result.invocations[0]?.action).toBe('change_stage');
    expect(result.invocations[1]?.action).toBe('send_content');
    expect(result.invocations[2]?.action).toBe('send_content');
    expect(result.newStage).toBe('MS');
  });
});

describe('advanceDialogue — HumanHandoff interrupt', () => {
  it('returns interrupt immediately', () => {
    const input: FlowEngineInput = {
      state: EMPTY_STATE,
      commands: [
        {
          type: 'HumanHandoff',
          kind: 'agent',
          reason: 'explicit request',
          source: 'llm',
        },
      ],
      flows: new Map(),
      transitions: [],
      currentStage: 'A',
      now: NOW,
    };
    const result = advanceDialogue(input);
    expect(result.interrupt).not.toBeNull();
    expect(result.interrupt?.kind).toBe('agent');
    expect(result.interrupt?.reason).toBe('explicit request');
  });
});

describe('advanceDialogue — SetSlot', () => {
  it('sets global slot', () => {
    const input: FlowEngineInput = {
      state: EMPTY_STATE,
      commands: [{ type: 'SetSlot', slot: 'city', value: 'Madrid', evidence: 'test' }],
      flows: new Map(),
      transitions: [],
      currentStage: 'A',
      now: NOW,
    };
    const result = advanceDialogue(input);
    expect(result.state.slots.city).toBe('Madrid');
  });

  it('sets dot-path nested slot', () => {
    const input: FlowEngineInput = {
      state: EMPTY_STATE,
      commands: [
        { type: 'SetSlot', slot: 'conflict_result.has_conflict', value: true, evidence: 'test' },
      ],
      flows: new Map(),
      transitions: [],
      currentStage: 'A',
      now: NOW,
    };
    const result = advanceDialogue(input);
    const nested = result.state.slots.conflict_result as Record<string, unknown>;
    expect(nested?.has_conflict).toBe(true);
  });
});

describe('advanceDialogue — repair_context continue_interrupted', () => {
  const flowA = makeFlow('flow_a', [
    {
      id: 's1',
      type: 'collect',
      slot: 'name',
      prompt_hint: 'Ask name',
      validation: 'text',
      skip_if_filled: true,
    },
  ]);
  const flowB = makeFlow('flow_b', [
    {
      id: 's1',
      type: 'action',
      action: 'reply_text',
      config: { text: 'Done' },
      on_failure: 'abort',
    },
  ]);

  it('after nested flow completes, sets continue_interrupted on interrupted frame', () => {
    // Start with flow_a interrupted, flow_b on top
    const stateWithStack: DialogueState = {
      ...EMPTY_STATE,
      stack: [
        {
          flow_id: 'flow_a',
          flow_version: 1,
          step_id: 's1',
          frame_slots: {},
          started_at: NOW,
          interrupted_at: NOW,
        },
        {
          flow_id: 'flow_b',
          flow_version: 1,
          step_id: 's1',
          frame_slots: {},
          started_at: NOW,
          interrupted_at: null,
        },
      ],
    };

    const input: FlowEngineInput = {
      state: stateWithStack,
      commands: [],
      flows: new Map([
        ['flow_a', flowA],
        ['flow_b', flowB],
      ]),
      transitions: [],
      currentStage: 'A',
      now: NOW,
    };
    const result = advanceDialogue(input);
    // flow_b runs its action step and pops. Stack now has flow_a with interrupted_at
    // → repair_context set to continue_interrupted
    expect(result.invocations).toHaveLength(1);
    expect(result.state.repair_context?.pattern).toBe('continue_interrupted');
  });
});
