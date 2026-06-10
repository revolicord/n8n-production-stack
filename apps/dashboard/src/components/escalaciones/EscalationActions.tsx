'use client';

import {
  pauseLeadAction,
  resolveNotificationAction,
  resumeLeadAction,
} from '@/app/(dashboard)/escalaciones/_actions';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

interface EscalationActionsProps {
  notificationId: string;
  subscriberId: string;
  status: string; // 'pending' | 'resolved'
  isPaused: boolean;
}

const BTN =
  'rounded border border-qc-border px-2 py-0.5 text-[11px] text-qc-textMuted hover:text-white hover:bg-white/[0.05] transition-colors disabled:opacity-50';

export function EscalationActions({
  notificationId,
  subscriberId,
  status,
  isPaused,
}: EscalationActionsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error ?? 'Error');
      else router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      {isPaused ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => resumeLeadAction(subscriberId))}
          className={`${BTN} text-qc-teal50`}
        >
          ▶ Reanudar
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => pauseLeadAction(subscriberId))}
          className={BTN}
        >
          ⏸ Pausar
        </button>
      )}
      {status === 'pending' && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => resolveNotificationAction(notificationId, false))}
          className={BTN}
        >
          ✓ Resolver
        </button>
      )}
      {error && <span className="text-[10px] text-red-400">{error}</span>}
    </div>
  );
}
