import type { Notification } from '@dm-api/db';
import { describe, expect, it } from 'vitest';
import { buildHandoffState } from '../core/context/handoff.js';

function makeNotif(overrides: Partial<Notification>): Notification {
  return {
    id: 'test-id',
    tenantId: 'tenant-1',
    subscriberId: 'sub-1',
    conversationId: null,
    turnId: null,
    kind: 'agent',
    source: 'agent',
    reason: null,
    summary: null,
    status: 'pending',
    telegramChatId: null,
    telegramMessageId: null,
    metadata: {},
    createdAt: new Date('2024-01-01'),
    resolvedAt: null,
    resolvedBy: null,
    ...overrides,
  };
}

describe('buildHandoffState', () => {
  it('returns null when no notifications', () => {
    expect(buildHandoffState([])).toBeNull();
  });

  it('returns open_escalations for pending', () => {
    const n = makeNotif({ status: 'pending', kind: 'audio', reason: 'audio message' });
    const state = buildHandoffState([n]);
    expect(state).not.toBeNull();
    expect(state?.open_escalations).toHaveLength(1);
    expect(state?.open_escalations[0]?.kind).toBe('audio');
    expect(state?.human_handled).toBeNull();
  });

  it('returns human_handled for resolved', () => {
    const n = makeNotif({
      status: 'resolved',
      kind: 'keyword',
      summary: 'handled it',
      resolvedAt: new Date('2024-01-02'),
    });
    const state = buildHandoffState([n]);
    expect(state).not.toBeNull();
    expect(state?.open_escalations).toHaveLength(0);
    expect(state?.human_handled).toHaveLength(1);
    expect(state?.human_handled?.[0]?.note).toBe('handled it');
  });
});
