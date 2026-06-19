import type {
  DialogueCommand,
  DialogueState,
  FlowDefinition,
  FlowFrame,
  SlotValue,
} from '@dm-api/shared';
import { evaluateCondition } from './conditions.js';
import { setRepairContext } from './repair.js';
import {
  makeFrame,
  markFrameInterrupted,
  peekFrame,
  popFrame,
  pushFrame,
  replaceTopFrame,
} from './stack.js';

export interface TransitionRule {
  fromStageSlug: string;
  toStageSlug: string;
  whenToUse: string;
}

export interface ActionInvocation {
  action: string;
  config: Record<string, unknown>;
  save_as?: string | undefined;
  on_failure: 'abort' | 'continue' | 'handoff';
  origin: 'flow' | 'command';
}

export interface FlowEngineInput {
  state: DialogueState;
  commands: DialogueCommand[];
  flows: Map<string, { version: number; def: FlowDefinition }>;
  transitions: TransitionRule[];
  currentStage: string;
  now: string;
}

/** Paso del flow engine ejecutado en un turno (observabilidad, ADR-0025). */
export interface FlowPathStep {
  flow_id: string;
  step_id: string;
  type: string;
}

export interface FlowEngineResult {
  state: DialogueState;
  invocations: ActionInvocation[];
  pendingCollect: { slot: string; prompt_hint: string; flow_id: string } | null;
  interrupt: { reason: string; kind: string; summary?: string | undefined } | null;
  newStage: string | null;
  /** Pasos recorridos en la Fase 2 (vacío si no se ejecutó ningún flow). */
  path?: FlowPathStep[];
}

function setNestedSlot(
  slots: Record<string, SlotValue>,
  path: string,
  value: SlotValue,
): Record<string, SlotValue> {
  const parts = path.split('.');
  if (parts.length === 1) {
    return { ...slots, [path]: value };
  }
  const [first, ...rest] = parts;
  if (!first) return slots;
  const existing = slots[first];
  const nested: Record<string, SlotValue> =
    existing != null && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, SlotValue>)
      : {};
  const updated = setNestedSlot(nested, rest.join('.'), value);
  return { ...slots, [first]: updated as unknown as SlotValue };
}

function findTriggerFlows(
  flows: Map<string, { version: number; def: FlowDefinition }>,
  fromStage: string,
  toStage: string,
): Array<{ version: number; def: FlowDefinition }> {
  const matches: Array<{ version: number; def: FlowDefinition }> = [];
  for (const entry of flows.values()) {
    const t = entry.def.trigger;
    if (t.type !== 'stage_transition') continue;
    if (t.to !== toStage) continue;
    // Exact match first, then wildcard
    if (t.from === fromStage || t.from === '*') {
      matches.push(entry);
    }
  }
  // Sort: exact match before wildcard
  matches.sort((a, b) => {
    const aExact = a.def.trigger.type === 'stage_transition' && a.def.trigger.from !== '*' ? 0 : 1;
    const bExact = b.def.trigger.type === 'stage_transition' && b.def.trigger.from !== '*' ? 0 : 1;
    return aExact - bExact;
  });
  return matches;
}

function findStepById(def: FlowDefinition, stepId: string) {
  return def.steps.find((s) => s.id === stepId) ?? null;
}

function advanceFrame(frame: FlowFrame, stepId: string): FlowFrame {
  return {
    flow_id: frame.flow_id,
    flow_version: frame.flow_version,
    step_id: stepId,
    frame_slots: frame.frame_slots,
    started_at: frame.started_at,
    interrupted_at: frame.interrupted_at,
  };
}

function nextStepId(def: FlowDefinition, currentId: string, explicitNext?: string): string | null {
  if (explicitNext) return explicitNext;
  const idx = def.steps.findIndex((s) => s.id === currentId);
  if (idx === -1 || idx + 1 >= def.steps.length) return null;
  const next = def.steps[idx + 1];
  return next?.id ?? null;
}

export function advanceDialogue(input: FlowEngineInput): FlowEngineResult {
  let state: DialogueState = {
    ...input.state,
    stack: [...input.state.stack],
    slots: { ...input.state.slots },
  };
  const invocations: ActionInvocation[] = [];
  const path: FlowPathStep[] = [];
  let newStage: string | null = null;
  let currentStage = input.currentStage;

  // ─── Phase 1: Process commands ───────────────────────────────────────
  for (const cmd of input.commands) {
    if (cmd.type === 'SetSlot') {
      state = { ...state, slots: setNestedSlot(state.slots, cmd.slot, cmd.value) };
      continue;
    }

    if (cmd.type === 'StartFlow') {
      const flowEntry = input.flows.get(cmd.flow_id);
      if (!flowEntry) continue;
      const firstStep = flowEntry.def.steps[0];
      if (!firstStep) continue;

      // Mark current top as interrupted if there is one
      const top = peekFrame(state.stack);
      if (top && !top.interrupted_at) {
        state = {
          ...state,
          stack: replaceTopFrame(state.stack, markFrameInterrupted(top, input.now)),
        };
      }

      const newFrame = makeFrame(cmd.flow_id, flowEntry.version, firstStep.id, input.now);
      // Merge inputs into frame_slots
      const frameWithInputs: FlowFrame = { ...newFrame, frame_slots: { ...cmd.inputs } };
      state = { ...state, stack: pushFrame(state.stack, frameWithInputs) };
      continue;
    }

    if (cmd.type === 'CancelFlow') {
      if (cmd.flow_id) {
        state = { ...state, stack: state.stack.filter((f) => f.flow_id !== cmd.flow_id) };
      } else {
        state = { ...state, stack: popFrame(state.stack) };
      }
      continue;
    }

    if (cmd.type === 'HumanHandoff') {
      return {
        state,
        invocations,
        pendingCollect: null,
        interrupt: { reason: cmd.reason, kind: cmd.kind, summary: cmd.summary },
        newStage,
      };
    }

    if (cmd.type === 'ReplyText') {
      invocations.push({
        action: 'reply_text',
        config: { text: cmd.text },
        on_failure: 'abort',
        origin: 'command',
      });
      continue;
    }

    if (cmd.type === 'SendContent') {
      invocations.push({
        action: 'send_content',
        config: {
          slug_id: cmd.slug_id,
          evidence: cmd.evidence,
          lookup_stage: cmd.lookup_stage,
        },
        on_failure: 'abort',
        origin: 'command',
      });
      continue;
    }

    if (cmd.type === 'ChangeStage') {
      // Transición autorizada por el sistema (webhook confiable): salta la validación
      // contra stage_transitions_map. Permite C→D tras una reserva real manteniendo C→D
      // FUERA del mapa a propósito (anti-anzuelo). El LLM no puede setear este flag: se
      // sanea a false en understandNode, así que solo los system_commands lo llevan.
      const systemAuthorized = cmd.system_authorized === true;
      if (!systemAuthorized) {
        // Validate transition
        const allowed = input.transitions.filter((t) => t.fromStageSlug === currentStage);
        const valid = allowed.some((t) => t.toStageSlug === cmd.to_stage);
        if (!valid) continue; // invalid transition silently dropped
      }

      newStage = cmd.to_stage;
      currentStage = cmd.to_stage;

      invocations.push({
        action: 'change_stage',
        config: {
          to_stage: cmd.to_stage,
          reason: cmd.reason,
          evidence: cmd.evidence,
          lead_in: cmd.lead_in,
        },
        on_failure: 'abort',
        origin: 'command',
      });

      // Cascade: push trigger flows
      if (cmd.cascade) {
        const triggerFlows = findTriggerFlows(input.flows, input.currentStage, cmd.to_stage);
        for (const tf of triggerFlows) {
          const firstStep = tf.def.steps[0];
          if (!firstStep) continue;
          const top = peekFrame(state.stack);
          if (top && !top.interrupted_at) {
            state = {
              ...state,
              stack: replaceTopFrame(state.stack, markFrameInterrupted(top, input.now)),
            };
          }
          state = {
            ...state,
            stack: pushFrame(
              state.stack,
              makeFrame(tf.def.flow_id, tf.version, firstStep.id, input.now),
            ),
          };
        }
      }
      continue;
    }

    if (cmd.type === 'ScheduleFollowup') {
      invocations.push({
        action: 'schedule_followup',
        config: { delay_minutes: cmd.delay_minutes, note: cmd.note },
        on_failure: 'continue',
        origin: 'command',
      });
      continue;
    }

    if (cmd.type === 'Clarify') {
      invocations.push({
        action: 'reply_text',
        config: { text: cmd.text },
        on_failure: 'abort',
        origin: 'command',
      });
    }
  }

  // ─── Phase 2: Run active flow frame ──────────────────────────────────
  let top = peekFrame(state.stack);
  let loopGuard = 0;

  while (top !== null && loopGuard < 50) {
    loopGuard++;
    const flowEntry = input.flows.get(top.flow_id);
    if (!flowEntry) {
      state = { ...state, stack: popFrame(state.stack) };
      top = peekFrame(state.stack);
      continue;
    }

    const step = findStepById(flowEntry.def, top.step_id);
    if (!step) {
      // Step not found → pop frame
      state = { ...state, stack: popFrame(state.stack) };
      const newTop = peekFrame(state.stack);
      if (newTop?.interrupted_at) {
        state = setRepairContext(state, 'continue_interrupted', {}, input.now);
      }
      top = peekFrame(state.stack);
      continue;
    }

    // Observabilidad (ADR-0025): registra el paso visitado.
    path.push({ flow_id: top.flow_id, step_id: step.id, type: step.type });

    // Merge frame_slots into global slots for condition evaluation
    const mergedSlots = { ...state.slots, ...top.frame_slots };

    if (step.type === 'collect') {
      // Skip if slot already filled
      const filled = mergedSlots[step.slot] != null;
      if (step.skip_if_filled && filled) {
        const nxt = nextStepId(flowEntry.def, step.id, step.next);
        if (!nxt) {
          state = { ...state, stack: popFrame(state.stack) };
          const newTop = peekFrame(state.stack);
          if (newTop?.interrupted_at) {
            state = setRepairContext(state, 'continue_interrupted', {}, input.now);
          }
          top = peekFrame(state.stack);
        } else {
          state = { ...state, stack: replaceTopFrame(state.stack, advanceFrame(top, nxt)) };
          top = peekFrame(state.stack);
        }
        continue;
      }
      // Need to collect — pause execution
      return {
        state,
        invocations,
        pendingCollect: { slot: step.slot, prompt_hint: step.prompt_hint, flow_id: top.flow_id },
        interrupt: null,
        newStage,
        path,
      };
    }

    if (step.type === 'action') {
      invocations.push({
        action: step.action,
        config: step.config,
        save_as: step.save_as,
        on_failure: step.on_failure,
        origin: 'flow',
      });
      const nxt = nextStepId(flowEntry.def, step.id, step.next);
      if (!nxt) {
        state = { ...state, stack: popFrame(state.stack) };
        const newTop = peekFrame(state.stack);
        if (newTop?.interrupted_at) {
          state = setRepairContext(state, 'continue_interrupted', {}, input.now);
        }
        top = peekFrame(state.stack);
      } else {
        state = { ...state, stack: replaceTopFrame(state.stack, advanceFrame(top, nxt)) };
        top = peekFrame(state.stack);
      }
      continue;
    }

    if (step.type === 'branch') {
      const branchTop = top; // save non-null reference before for loop may reassign
      let matched = false;
      for (const c of step.cases) {
        if (evaluateCondition(c.when, mergedSlots)) {
          state = {
            ...state,
            stack: replaceTopFrame(state.stack, advanceFrame(branchTop, c.next)),
          };
          top = peekFrame(state.stack);
          matched = true;
          break;
        }
      }
      if (!matched) {
        const nxt = step.default ?? nextStepId(flowEntry.def, step.id, step.next);
        if (!nxt) {
          state = { ...state, stack: popFrame(state.stack) };
          const newTop = peekFrame(state.stack);
          if (newTop?.interrupted_at) {
            state = setRepairContext(state, 'continue_interrupted', {}, input.now);
          }
          top = peekFrame(state.stack);
        } else {
          state = { ...state, stack: replaceTopFrame(state.stack, advanceFrame(branchTop, nxt)) };
          top = peekFrame(state.stack);
        }
      }
      continue;
    }

    if (step.type === 'link') {
      const linked = input.flows.get(step.flow_id);
      if (!linked) {
        state = { ...state, stack: popFrame(state.stack) };
        top = peekFrame(state.stack);
        continue;
      }
      const firstStep = linked.def.steps[0];
      if (!firstStep) {
        state = { ...state, stack: popFrame(state.stack) };
        top = peekFrame(state.stack);
        continue;
      }
      // Tail-call: replace current frame with linked flow
      state = {
        ...state,
        stack: replaceTopFrame(
          state.stack,
          makeFrame(step.flow_id, linked.version, firstStep.id, input.now),
        ),
      };
      top = peekFrame(state.stack);
      continue;
    }

    // Unknown step type — pop to avoid infinite loop
    state = { ...state, stack: popFrame(state.stack) };
    top = peekFrame(state.stack);
  }

  return { state, invocations, pendingCollect: null, interrupt: null, newStage, path };
}
