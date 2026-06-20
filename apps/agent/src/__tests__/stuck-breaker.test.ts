import { describe, expect, it } from 'vitest';
import type { AssembledContext } from '../core/context/assemble.js';
import { DEFAULT_MAX_TURNS_IN_STAGE, tryStuckBreaker } from '../graph/nodes/stuck-breaker.js';

function makeCtx(overrides: Partial<AssembledContext> = {}): AssembledContext {
  return {
    currentStage: 'A',
    tenantConfig: {},
    funnelStages: [
      { slug: 'A', isTerminal: false },
      { slug: 'B', isTerminal: false },
      { slug: 'disqualified', isTerminal: true },
    ],
    transitions: [
      { fromStageSlug: 'A', toStageSlug: 'B', whenToUse: 'avance', trigger: 'affirm' },
      { fromStageSlug: 'A', toStageSlug: 'disqualified', whenToUse: 'rechazo', trigger: 'deny' },
    ],
    dialogueState: { version: 1, stack: [], slots: {}, repair_context: null, last_turn_id: null },
    handoffState: null,
    turnsInCurrentStage: 0,
    ...overrides,
    // biome-ignore lint/suspicious/noExplicitAny: only the fields read by tryStuckBreaker matter
  } as any;
}

describe('tryStuckBreaker (circuit breaker de la cola caótica)', () => {
  it('NO dispara bajo el umbral (caso normal)', () => {
    const r = tryStuckBreaker(makeCtx({ turnsInCurrentStage: 3 }));
    expect(r.kind).toBe('pass');
    if (r.kind === 'pass') expect(r.skipReason).toBe('under_threshold');
  });

  it('dispara handoff al alcanzar el umbral por defecto', () => {
    const r = tryStuckBreaker(makeCtx({ turnsInCurrentStage: DEFAULT_MAX_TURNS_IN_STAGE }));
    expect(r.kind).toBe('break');
    if (r.kind === 'break') {
      expect(r.result.command.type).toBe('HumanHandoff');
      if (r.result.command.type === 'HumanHandoff') {
        expect(r.result.command.kind).toBe('agent');
        expect(r.result.command.source).toBe('code');
      }
    }
  });

  it('respeta max_turns_in_stage configurable', () => {
    const ctx = makeCtx({
      turnsInCurrentStage: 4,
      tenantConfig: { stuck_detector: { max_turns_in_stage: 4 } } as never,
    });
    expect(tryStuckBreaker(ctx).kind).toBe('break');
  });

  it('action=disqualify avanza por la transición trigger:deny', () => {
    const ctx = makeCtx({
      turnsInCurrentStage: 12,
      tenantConfig: { stuck_detector: { action: 'disqualify' } } as never,
    });
    const r = tryStuckBreaker(ctx);
    expect(r.kind).toBe('break');
    if (r.kind === 'break' && r.result.command.type === 'ChangeStage') {
      expect(r.result.command.to_stage).toBe('disqualified');
      expect(r.result.command.cascade).toBe(true);
    } else {
      throw new Error('esperaba ChangeStage a disqualified');
    }
  });

  it('action=disqualify cae a handoff si no hay transición deny', () => {
    const ctx = makeCtx({
      turnsInCurrentStage: 12,
      tenantConfig: { stuck_detector: { action: 'disqualify' } } as never,
      transitions: [
        { fromStageSlug: 'A', toStageSlug: 'B', whenToUse: 'avance', trigger: 'affirm' },
        // biome-ignore lint/suspicious/noExplicitAny: stub
      ] as any,
    });
    const r = tryStuckBreaker(ctx);
    expect(r.kind).toBe('break');
    if (r.kind === 'break') expect(r.result.command.type).toBe('HumanHandoff');
  });

  it('NO dispara en etapa terminal (is_terminal)', () => {
    const r = tryStuckBreaker(makeCtx({ currentStage: 'disqualified', turnsInCurrentStage: 50 }));
    expect(r.kind).toBe('pass');
    if (r.kind === 'pass') expect(r.skipReason).toBe('exempt_stage');
  });

  it('NO dispara en etapas eximidas por config', () => {
    const ctx = makeCtx({
      turnsInCurrentStage: 50,
      tenantConfig: { stuck_detector: { exempt_stages: ['A'] } } as never,
    });
    const r = tryStuckBreaker(ctx);
    expect(r.kind).toBe('pass');
    if (r.kind === 'pass') expect(r.skipReason).toBe('exempt_stage');
  });

  it('NO dispara si ya hay una escalación abierta (humano en el caso)', () => {
    const ctx = makeCtx({
      turnsInCurrentStage: 50,
      // biome-ignore lint/suspicious/noExplicitAny: stub handoffState
      handoffState: { open_escalations: [{ id: 'n1' }], human_handled: null } as any,
    });
    const r = tryStuckBreaker(ctx);
    expect(r.kind).toBe('pass');
    if (r.kind === 'pass') expect(r.skipReason).toBe('already_handling');
  });

  it('NO dispara con repair_context activo', () => {
    const ctx = makeCtx({
      turnsInCurrentStage: 50,
      dialogueState: {
        version: 1,
        stack: [],
        slots: {},
        // biome-ignore lint/suspicious/noExplicitAny: stub
        repair_context: { pattern: 'human_handoff', payload: {}, since: 'x' } as any,
        last_turn_id: null,
      },
    });
    const r = tryStuckBreaker(ctx);
    expect(r.kind).toBe('pass');
    if (r.kind === 'pass') expect(r.skipReason).toBe('already_handling');
  });

  it('se puede desactivar por tenant (enabled:false)', () => {
    const ctx = makeCtx({
      turnsInCurrentStage: 50,
      tenantConfig: { stuck_detector: { enabled: false } } as never,
    });
    const r = tryStuckBreaker(ctx);
    expect(r.kind).toBe('pass');
    if (r.kind === 'pass') expect(r.skipReason).toBe('disabled');
  });
});
