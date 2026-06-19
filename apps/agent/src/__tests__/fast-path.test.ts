import type { TurnInput } from '@dm-api/shared';
import { describe, expect, it } from 'vitest';
import type { AssembledContext } from '../core/context/assemble.js';
import { tryFastPath } from '../graph/nodes/fast-path.js';

function makeCtx(overrides: Partial<AssembledContext> = {}): AssembledContext {
  return {
    currentStage: 'A',
    tenantConfig: { text_policy_by_stage: { A: 'flow_only' } },
    transitions: [{ fromStageSlug: 'A', toStageSlug: 'B', whenToUse: 'avance' }],
    funnelStages: [
      { slug: 'A', isTerminal: false },
      { slug: 'B', isTerminal: false },
      { slug: 'disqualified', isTerminal: true },
    ],
    dialogueState: { version: 1, stack: [], slots: {}, repair_context: null, last_turn_id: null },
    handoffState: null,
    ...overrides,
    // biome-ignore lint/suspicious/noExplicitAny: only the fields read by tryFastPath matter
  } as any;
}

function makeInput(messages: Array<{ text?: string; content_class?: string }>): TurnInput {
  return {
    turn_id: 't-1',
    tenant_id: 'tenant-1',
    subscriber_id: 'sub-1',
    conversation_id: 'c-1',
    dry_run: false,
    trigger: { channel: 'instagram' },
    messages: messages.map((m) => ({ text: m.text, content_class: m.content_class ?? 'text' })),
    system_commands: [],
    // biome-ignore lint/suspicious/noExplicitAny: partial TurnInput stub
  } as any;
}

describe('tryFastPath (camino feliz determinista)', () => {
  it('avanza sin LLM ante señal positiva de texto', () => {
    const r = tryFastPath(makeInput([{ text: 'ok' }]), makeCtx());
    expect(r.kind).toBe('fast_path');
    if (r.kind !== 'fast_path') return;
    expect(r.result.commands).toHaveLength(1);
    const cmd = r.result.commands[0];
    expect(cmd?.type).toBe('ChangeStage');
    if (cmd?.type === 'ChangeStage') {
      expect(cmd.to_stage).toBe('B');
      expect(cmd.cascade).toBe(true);
      expect(cmd.system_authorized).toBe(false);
    }
  });

  it.each(['si', 'Sí', 'listo', 'ya lo vi', 'Dale!', 'perfecto', 'VALE', 'ya'])(
    'reconoce la señal positiva "%s"',
    (text) => {
      expect(tryFastPath(makeInput([{ text }]), makeCtx()).kind).toBe('fast_path');
    },
  );

  it.each(['👍', '👍🏽', '👌🔥', '🙌'])('reconoce el emoji de aprobación "%s"', (text) => {
    expect(tryFastPath(makeInput([{ text }]), makeCtx()).kind).toBe('fast_path');
  });

  it('cae al LLM con skipReason "not_positive_signal" si es pregunta/ambiguo', () => {
    for (const text of ['sí pero cuánto cuesta?', 'mmm no sé', 'todavía no lo vi']) {
      const r = tryFastPath(makeInput([{ text }]), makeCtx());
      expect(r.kind).toBe('llm');
      if (r.kind === 'llm') expect(r.skipReason).toBe('not_positive_signal');
    }
  });

  it('avanza con 👍 aunque exista la escotilla A→disqualified (terminal no cuenta)', () => {
    const ctx = makeCtx({
      transitions: [
        { fromStageSlug: 'A', toStageSlug: 'disqualified', whenToUse: 'rechazo' },
        { fromStageSlug: 'A', toStageSlug: 'B', whenToUse: 'avance' },
        // biome-ignore lint/suspicious/noExplicitAny: stub
      ] as any,
    });
    const r = tryFastPath(makeInput([{ text: '👍' }]), ctx);
    expect(r.kind).toBe('fast_path');
    if (r.kind === 'fast_path') {
      const cmd = r.result.commands[0];
      if (cmd?.type === 'ChangeStage') expect(cmd.to_stage).toBe('B');
    }
  });

  it('skipReason "ambiguous_target" si disqualified NO está marcado is_terminal', () => {
    const ctx = makeCtx({
      funnelStages: [
        { slug: 'A', isTerminal: false },
        { slug: 'B', isTerminal: false },
        { slug: 'disqualified', isTerminal: false }, // ← el bug típico de seed
        // biome-ignore lint/suspicious/noExplicitAny: stub
      ] as any,
      transitions: [
        { fromStageSlug: 'A', toStageSlug: 'disqualified', whenToUse: 'rechazo' },
        { fromStageSlug: 'A', toStageSlug: 'B', whenToUse: 'avance' },
        // biome-ignore lint/suspicious/noExplicitAny: stub
      ] as any,
    });
    const r = tryFastPath(makeInput([{ text: '👍' }]), ctx);
    expect(r.kind).toBe('llm');
    if (r.kind === 'llm') expect(r.skipReason).toBe('ambiguous_target');
  });

  it('skipReason "stage_not_flow_only" si la etapa no es flow_only', () => {
    const ctx = makeCtx({ tenantConfig: { text_policy_by_stage: { A: 'text_ok' } } as never });
    const r = tryFastPath(makeInput([{ text: 'ok' }]), ctx);
    expect(r.kind === 'llm' && r.skipReason).toBe('stage_not_flow_only');
  });

  it('skipReason según el número de transiciones de avance', () => {
    const none = makeCtx({ transitions: [] });
    const rNone = tryFastPath(makeInput([{ text: 'ok' }]), none);
    expect(rNone.kind === 'llm' && rNone.skipReason).toBe('no_forward_transition');

    const many = makeCtx({
      transitions: [
        { fromStageSlug: 'A', toStageSlug: 'B', whenToUse: 'x' },
        { fromStageSlug: 'A', toStageSlug: 'C', whenToUse: 'y' },
        // biome-ignore lint/suspicious/noExplicitAny: stub
      ] as any,
    });
    const rMany = tryFastPath(makeInput([{ text: 'ok' }]), many);
    expect(rMany.kind === 'llm' && rMany.skipReason).toBe('ambiguous_target');
  });

  it('skipReason "repair_context_active" / "open_escalation"', () => {
    const repairing = makeCtx({
      dialogueState: {
        version: 1,
        stack: [],
        slots: {},
        repair_context: { pattern: 'human_handoff', payload: {}, since: 'now' },
        last_turn_id: null,
        // biome-ignore lint/suspicious/noExplicitAny: stub
      } as any,
    });
    const rRepair = tryFastPath(makeInput([{ text: 'ok' }]), repairing);
    expect(rRepair.kind === 'llm' && rRepair.skipReason).toBe('repair_context_active');

    const escalated = makeCtx({
      // biome-ignore lint/suspicious/noExplicitAny: stub
      handoffState: { open_escalations: [{ kind: 'agent', since: 'now' }] } as any,
    });
    const rEsc = tryFastPath(makeInput([{ text: 'ok' }]), escalated);
    expect(rEsc.kind === 'llm' && rEsc.skipReason).toBe('open_escalation');
  });

  it('skipReason "non_text_message" si algún mensaje no es texto', () => {
    const r = tryFastPath(makeInput([{ text: 'ok', content_class: 'audio' }]), makeCtx());
    expect(r.kind === 'llm' && r.skipReason).toBe('non_text_message');
  });

  it('skipReason "has_system_commands" si hay system_commands inyectados', () => {
    const input = makeInput([{ text: 'ok' }]);
    // biome-ignore lint/suspicious/noExplicitAny: stub system command
    (input as any).system_commands = [{ type: 'SetSlot', slot: 'x', value: 1, evidence: 'sys' }];
    const r = tryFastPath(input, makeCtx());
    expect(r.kind === 'llm' && r.skipReason).toBe('has_system_commands');
  });
});
