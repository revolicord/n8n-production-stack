'use server';

import { type ActionResult, adminFetch, readError } from '@/lib/admin-api';
import { revalidatePath } from 'next/cache';

export async function resolveNotificationAction(
  id: string,
  resume: boolean,
): Promise<ActionResult> {
  const res = await adminFetch(`/notifications/${id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ resolved_by: 'dashboard', resume }),
  });
  if (!res.ok) return { ok: false, error: await readError(res) };
  revalidatePath('/escalaciones');
  return { ok: true };
}

export async function pauseLeadAction(subscriberId: string): Promise<ActionResult> {
  const res = await adminFetch(`/leads/${subscriberId}/pause`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (!res.ok) return { ok: false, error: await readError(res) };
  revalidatePath('/escalaciones');
  revalidatePath('/prospects');
  return { ok: true };
}

export async function resumeLeadAction(subscriberId: string): Promise<ActionResult> {
  const res = await adminFetch(`/leads/${subscriberId}/resume`, { method: 'POST' });
  if (!res.ok) return { ok: false, error: await readError(res) };
  revalidatePath('/escalaciones');
  revalidatePath('/prospects');
  return { ok: true };
}
