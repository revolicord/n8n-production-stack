import type { TurnInput } from '@dm-api/shared';
import { describe, expect, it } from 'vitest';
import type { AssembledContext } from '../core/context/assemble.js';
import { resolveAffirmSignals, tryFastPath } from '../graph/nodes/fast-path.js';

function makeCtx(overrides: Partial<AssembledContext> = {}): AssembledContext {
  return {
    currentStage: 'A',
    tenantConfig: { text_policy_by_stage: { A: 'flow_only' } },
    transitions: [
      { fromStageSlug: 'A', toStageSlug: 'B', whenToUse: 'avance', trigger: 'affirm' },
      { fromStageSlug: 'A', toStageSlug: 'disqualified', whenToUse: 'rechazo', trigger: 'deny' },
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

  it('toma la arista trigger:affirm (B) e ignora la escotilla deny (disqualified)', () => {
    // makeCtx por defecto ya tiene A→B (affirm) + A→disqualified (deny).
    const r = tryFastPath(makeInput([{ text: '👍' }]), makeCtx());
    expect(r.kind).toBe('fast_path');
    if (r.kind === 'fast_path') {
      const cmd = r.result.commands[0];
      if (cmd?.type === 'ChangeStage') expect(cmd.to_stage).toBe('B');
    }
  });

  it('skipReason "no_affirm_transition" si las transiciones existen pero sin trigger', () => {
    // El bug real del seed: las aristas existen pero ninguna tiene trigger='affirm'.
    const ctx = makeCtx({
      transitions: [
        { fromStageSlug: 'A', toStageSlug: 'B', whenToUse: 'avance', trigger: null },
        { fromStageSlug: 'A', toStageSlug: 'disqualified', whenToUse: 'rechazo', trigger: null },
        // biome-ignore lint/suspicious/noExplicitAny: stub
      ] as any,
    });
    const r = tryFastPath(makeInput([{ text: '👍' }]), ctx);
    expect(r.kind).toBe('llm');
    if (r.kind === 'llm') expect(r.skipReason).toBe('no_affirm_transition');
  });

  it('skipReason "stage_not_flow_only" si la etapa no es flow_only', () => {
    const ctx = makeCtx({ tenantConfig: { text_policy_by_stage: { A: 'text_ok' } } as never });
    const r = tryFastPath(makeInput([{ text: 'ok' }]), ctx);
    expect(r.kind === 'llm' && r.skipReason).toBe('stage_not_flow_only');
  });

  it('skipReason según las aristas trigger:affirm', () => {
    // 0 affirm (solo escotilla deny) → sin avance feliz.
    const none = makeCtx({
      transitions: [
        { fromStageSlug: 'A', toStageSlug: 'disqualified', whenToUse: 'x', trigger: 'deny' },
        // biome-ignore lint/suspicious/noExplicitAny: stub
      ] as any,
    });
    const rNone = tryFastPath(makeInput([{ text: 'ok' }]), none);
    expect(rNone.kind === 'llm' && rNone.skipReason).toBe('no_affirm_transition');

    // >1 affirm (mal configurado) → destino ambiguo.
    const many = makeCtx({
      transitions: [
        { fromStageSlug: 'A', toStageSlug: 'B', whenToUse: 'x', trigger: 'affirm' },
        { fromStageSlug: 'A', toStageSlug: 'C', whenToUse: 'y', trigger: 'affirm' },
        // biome-ignore lint/suspicious/noExplicitAny: stub
      ] as any,
    });
    const rMany = tryFastPath(makeInput([{ text: 'ok' }]), many);
    expect(rMany.kind === 'llm' && rMany.skipReason).toBe('ambiguous_target');
  });

  it('robusto a bifurcaciones: B→C (affirm) + B→nurture (deny) avanza a C', () => {
    const ctx = makeCtx({
      currentStage: 'B',
      tenantConfig: { text_policy_by_stage: { B: 'flow_only' } } as never,
      transitions: [
        { fromStageSlug: 'B', toStageSlug: 'C', whenToUse: 'avance', trigger: 'affirm' },
        { fromStageSlug: 'B', toStageSlug: 'nurture', whenToUse: 'no listo', trigger: 'deny' },
        // biome-ignore lint/suspicious/noExplicitAny: stub
      ] as any,
    });
    const r = tryFastPath(makeInput([{ text: '👍' }]), ctx);
    expect(r.kind).toBe('fast_path');
    if (r.kind === 'fast_path') {
      const cmd = r.result.commands[0];
      if (cmd?.type === 'ChangeStage') expect(cmd.to_stage).toBe('C');
    }
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

  it('señales del tenant: "oki" no es default pero avanza si el tenant la agrega', () => {
    const base = makeCtx();
    // Sin override: "oki" no matchea → LLM.
    expect(tryFastPath(makeInput([{ text: 'oki' }]), base).kind).toBe('llm');

    // El dashboard agrega la variación → fast-path sin tocar código.
    const ctx = makeCtx({
      tenantConfig: {
        text_policy_by_stage: { A: 'flow_only' },
        affirm_signals: { phrases: ['oki', 'ya quedó'] },
      } as never,
    });
    expect(tryFastPath(makeInput([{ text: 'oki' }]), ctx).kind).toBe('fast_path');
    // Se normaliza igual que el input (acentos/case).
    expect(tryFastPath(makeInput([{ text: 'YA QUEDO' }]), ctx).kind).toBe('fast_path');
  });

  it('mode:replace ignora frases default pero conserva el 👍', () => {
    const ctx = makeCtx({
      tenantConfig: {
        text_policy_by_stage: { A: 'flow_only' },
        affirm_signals: { phrases: ['solo esto'], mode: 'replace' },
      } as never,
    });
    // "ok" es default pero con replace ya no cuenta.
    expect(tryFastPath(makeInput([{ text: 'ok' }]), ctx).kind).toBe('llm');
    expect(tryFastPath(makeInput([{ text: 'solo esto' }]), ctx).kind).toBe('fast_path');
    // El pulgar arriba SIEMPRE sigue siendo cero-tokens, incluso con replace.
    expect(tryFastPath(makeInput([{ text: '👍' }]), ctx).kind).toBe('fast_path');
  });

  it('resolveAffirmSignals: extend suma a defaults; emoji base siempre presente', () => {
    const def = resolveAffirmSignals({});
    expect(def.phrases.has('ok')).toBe(true);
    expect(def.emojis.has('👍')).toBe(true);

    const ext = resolveAffirmSignals({ affirm_signals: { phrases: ['Oki!'], emojis: ['🤙'] } });
    expect(ext.phrases.has('ok')).toBe(true); // default conservado
    expect(ext.phrases.has('oki')).toBe(true); // normalizado y agregado
    expect(ext.emojis.has('🤙')).toBe(true);
    expect(ext.emojis.has('👍')).toBe(true);

    const rep = resolveAffirmSignals({ affirm_signals: { phrases: ['x'], mode: 'replace' } });
    expect(rep.phrases.has('ok')).toBe(false); // default descartado
    expect(rep.emojis.has('👍')).toBe(true); // emoji base SIEMPRE
  });
});
