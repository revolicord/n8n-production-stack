import type { FlowFrame } from '@dm-api/shared';

export function peekFrame(stack: FlowFrame[]): FlowFrame | null {
  return stack[stack.length - 1] ?? null;
}

export function pushFrame(stack: FlowFrame[], frame: FlowFrame): FlowFrame[] {
  return [...stack, frame];
}

export function popFrame(stack: FlowFrame[]): FlowFrame[] {
  return stack.slice(0, -1);
}

export function replaceTopFrame(stack: FlowFrame[], updated: FlowFrame): FlowFrame[] {
  return [...stack.slice(0, -1), updated];
}

export function markFrameInterrupted(frame: FlowFrame, at: string): FlowFrame {
  return { ...frame, interrupted_at: at };
}

export function makeFrame(flowId: string, version: number, stepId: string, now: string): FlowFrame {
  return {
    flow_id: flowId,
    flow_version: version,
    step_id: stepId,
    frame_slots: {},
    started_at: now,
    interrupted_at: null,
  };
}
