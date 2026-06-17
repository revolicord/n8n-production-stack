'use server';

import { type ActionResult, adminFetch, readError } from '@/lib/admin-api';
import { revalidatePath } from 'next/cache';

export type CreateTransitionInput = {
  from_stage_slug: string;
  to_stage_slug: string;
  when_to_use: string;
};

export type TransitionPatch = {
  when_to_use?: string;
  is_active?: boolean;
};

export async function createTransition(
  tenantId: string,
  input: CreateTransitionInput,
): Promise<ActionResult> {
  const res = await adminFetch(`/tenants/${tenantId}/stage-transitions`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!res.ok) return { ok: false, error: await readError(res) };
  revalidatePath('/settings', 'layout');
  return { ok: true };
}

export async function updateTransition(id: string, patch: TransitionPatch): Promise<ActionResult> {
  const res = await adminFetch(`/stage-transitions/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
  if (!res.ok) return { ok: false, error: await readError(res) };
  revalidatePath('/settings', 'layout');
  return { ok: true };
}

export async function deleteTransition(id: string): Promise<ActionResult> {
  const res = await adminFetch(`/stage-transitions/${id}`, { method: 'DELETE' });
  if (!res.ok) return { ok: false, error: await readError(res) };
  revalidatePath('/settings', 'layout');
  return { ok: true };
}
