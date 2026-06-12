import type { Notification } from '@dm-api/db';

export interface HandoffState {
  open_escalations: Array<{
    id: string;
    kind: string;
    reason: string | null;
    summary: string | null;
    since: string;
  }>;
  human_handled: Array<{
    id: string;
    kind: string;
    note: string | null;
    resolved_at: string;
  }> | null;
}

export function buildHandoffState(
  notifications: Notification[],
  maxResolved = 3,
): HandoffState | null {
  const pending = notifications.filter((n) => n.status === 'pending');
  const resolved = notifications.filter((n) => n.status === 'resolved').slice(0, maxResolved);

  if (pending.length === 0 && resolved.length === 0) return null;

  return {
    open_escalations: pending.map((n) => ({
      id: n.id,
      kind: n.kind,
      reason: n.reason ?? null,
      summary: n.summary ?? null,
      since: n.createdAt.toISOString(),
    })),
    human_handled:
      resolved.length > 0
        ? resolved.map((n) => ({
            id: n.id,
            kind: n.kind,
            note: n.summary ?? null,
            resolved_at: n.resolvedAt?.toISOString() ?? '',
          }))
        : null,
  };
}
