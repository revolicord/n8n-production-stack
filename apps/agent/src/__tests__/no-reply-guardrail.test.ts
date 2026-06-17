import type { TurnInput } from '@dm-api/shared';
import { describe, expect, it } from 'vitest';
import type { AssembledContext } from '../core/context/assemble.js';
import type { FlowEngineResult } from '../core/flow-engine/engine.js';
import type { Deps } from '../deps.js';
import { executeActionsNode } from '../graph/nodes/execute-actions.js';

const noopLogger = {
  child: () => noopLogger,
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  // biome-ignore lint/suspicious/noExplicitAny: test stub
} as any;

function makeDeps(): Deps {
  // biome-ignore lint/suspicious/noExplicitAny: minimal stub; dry_run handlers don't touch db/redis
  return { logger: noopLogger, db: {} as any, redis: {} as any } as Deps;
}

function makeCtx(overrides: Partial<AssembledContext> = {}): AssembledContext {
  return {
    tenant: { id: 'tenant-1' },
    tenantConfig: {},
    subscriber: { id: 'sub-1', manychatSubscriberId: 'mc-1' },
    stageCatalog: [],
    currentStage: 'A',
    ...overrides,
    // biome-ignore lint/suspicious/noExplicitAny: only the fields read by the node matter
  } as any;
}

function makeInput(): TurnInput {
  return {
    turn_id: 't-1',
    tenant_id: 'tenant-1',
    subscriber_id: 'sub-1',
    conversation_id: 'c-1',
    dry_run: true,
    trigger: { channel: 'instagram' },
    messages: [],
    system_commands: [],
    // biome-ignore lint/suspicious/noExplicitAny: partial TurnInput stub
  } as any;
}

function flowResult(invocations: FlowEngineResult['invocations']): FlowEngineResult {
  return {
    state: { version: 1, stack: [], slots: {}, repair_context: null, last_turn_id: null },
    invocations,
    pendingCollect: null,
    interrupt: null,
    newStage: invocations.some((i) => i.action === 'change_stage') ? 'MS' : null,
  };
}

describe('no-reply guardrail (execute-actions)', () => {
  it('fires fallback when a turn only changes stage (silent ChangeStage)', async () => {
    const fr = flowResult([
      {
        action: 'change_stage',
        config: { to_stage: 'MS', evidence: 'thumbs up' },
        on_failure: 'abort',
        origin: 'command',
      },
    ]);

    const out = await executeActionsNode(makeInput(), fr, makeCtx(), makeDeps());

    expect(out.responseTexts.length).toBeGreaterThan(0);
    const guardrailed = out.results.find(
      (r) => (r.detail as { guardrail?: string }).guardrail === 'no_reply',
    );
    expect(guardrailed).toBeDefined();
  });

  it('uses tenant no_reply_fallback_text when configured', async () => {
    const fr = flowResult([
      {
        action: 'change_stage',
        config: { to_stage: 'MS', evidence: 'thumbs up' },
        on_failure: 'abort',
        origin: 'command',
      },
    ]);
    const ctx = makeCtx({
      // biome-ignore lint/suspicious/noExplicitAny: partial tenantConfig
      tenantConfig: { no_reply_fallback_text: 'Texto custom del tenant' } as any,
    });

    const out = await executeActionsNode(makeInput(), fr, ctx, makeDeps());

    expect(out.responseTexts).toContain('Texto custom del tenant');
  });

  it('does NOT fire when the turn already replied with text', async () => {
    const fr = flowResult([
      { action: 'reply_text', config: { text: 'hola' }, on_failure: 'abort', origin: 'command' },
    ]);

    const out = await executeActionsNode(makeInput(), fr, makeCtx(), makeDeps());

    const guardrailed = out.results.find(
      (r) => (r.detail as { guardrail?: string }).guardrail === 'no_reply',
    );
    expect(guardrailed).toBeUndefined();
    expect(out.responseTexts).toEqual(['hola']);
  });
});
