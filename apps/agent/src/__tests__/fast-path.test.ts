import type { TurnInput } from '@dm-api/shared';
import { describe, expect, it } from 'vitest';
import type { AssembledContext } from '../core/context/assemble.js';
import { tryFastPath } from '../graph/nodes/fast-path.js';

function makeCtx(overrides: Partial<AssembledContext> = {}): AssembledContext {
  return {
    currentStage: 'A',
    tenantConfig: { text_policy_by_stage: { A: 'flow_only' } },
    transitions: [{ fromStageSlug: 'A', toStageSlug: 'B', whenToUse: 'avance' }],
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
    expect(r).not.toBeNull();
    expect(r?.commands).toHaveLength(1);
    const cmd = r?.commands[0];
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
      expect(tryFastPath(makeInput([{ text }]), makeCtx())).not.toBeNull();
    },
  );

  it.each(['👍', '👍🏽', '👌🔥', '🙌'])('reconoce el emoji de aprobación "%s"', (text) => {
    expect(tryFastPath(makeInput([{ text }]), makeCtx())).not.toBeNull();
  });

  it('NO fast-path si el mensaje es una pregunta (aunque empiece por sí)', () => {
    expect(tryFastPath(makeInput([{ text: 'sí pero cuánto cuesta?' }]), makeCtx())).toBeNull();
  });

  it('NO fast-path con texto ambiguo / objeción', () => {
    expect(tryFastPath(makeInput([{ text: 'mmm no sé' }]), makeCtx())).toBeNull();
    expect(tryFastPath(makeInput([{ text: 'todavía no lo vi' }]), makeCtx())).toBeNull();
  });

  it('NO fast-path si la etapa no es flow_only', () => {
    const ctx = makeCtx({ tenantConfig: { text_policy_by_stage: { A: 'text_ok' } } as never });
    expect(tryFastPath(makeInput([{ text: 'ok' }]), ctx)).toBeNull();
  });

  it('NO fast-path si hay 0 o >1 transiciones válidas (destino ambiguo)', () => {
    const none = makeCtx({ transitions: [] });
    expect(tryFastPath(makeInput([{ text: 'ok' }]), none)).toBeNull();

    const many = makeCtx({
      transitions: [
        { fromStageSlug: 'A', toStageSlug: 'B', whenToUse: 'x' },
        { fromStageSlug: 'A', toStageSlug: 'C', whenToUse: 'y' },
        // biome-ignore lint/suspicious/noExplicitAny: stub
      ] as any,
    });
    expect(tryFastPath(makeInput([{ text: 'ok' }]), many)).toBeNull();
  });

  it('NO fast-path si hay repair_context o escalación activa', () => {
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
    expect(tryFastPath(makeInput([{ text: 'ok' }]), repairing)).toBeNull();

    const escalated = makeCtx({
      // biome-ignore lint/suspicious/noExplicitAny: stub
      handoffState: { open_escalations: [{ kind: 'agent', since: 'now' }] } as any,
    });
    expect(tryFastPath(makeInput([{ text: 'ok' }]), escalated)).toBeNull();
  });

  it('NO fast-path si algún mensaje no es texto (posible escalado)', () => {
    expect(tryFastPath(makeInput([{ text: 'ok', content_class: 'audio' }]), makeCtx())).toBeNull();
  });

  it('NO fast-path si hay system_commands inyectados', () => {
    const input = makeInput([{ text: 'ok' }]);
    // biome-ignore lint/suspicious/noExplicitAny: stub system command
    (input as any).system_commands = [{ type: 'SetSlot', slot: 'x', value: 1, evidence: 'sys' }];
    expect(tryFastPath(input, makeCtx())).toBeNull();
  });
});
