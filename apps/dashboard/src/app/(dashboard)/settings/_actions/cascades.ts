'use server';

import { type ActionResult, adminFetch, readError } from '@/lib/admin-api';
import type { FlowDefinition } from '@dm-api/shared';
import { revalidatePath } from 'next/cache';

export async function createCascade(
  tenantId: string,
  definition: FlowDefinition,
): Promise<ActionResult> {
  const res = await adminFetch(`/tenants/${tenantId}/flow-definitions`, {
    method: 'POST',
    body: JSON.stringify({ definition }),
  });
  if (!res.ok) return { ok: false, error: await readError(res) };
  revalidatePath('/settings', 'layout');
  return { ok: true };
}

export async function updateCascade(id: string, definition: FlowDefinition): Promise<ActionResult> {
  const res = await adminFetch(`/flow-definitions/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ definition }),
  });
  if (!res.ok) return { ok: false, error: await readError(res) };
  revalidatePath('/settings', 'layout');
  return { ok: true };
}

export async function deleteCascade(id: string): Promise<ActionResult> {
  const res = await adminFetch(`/flow-definitions/${id}`, { method: 'DELETE' });
  if (!res.ok) return { ok: false, error: await readError(res) };
  revalidatePath('/settings', 'layout');
  return { ok: true };
}
