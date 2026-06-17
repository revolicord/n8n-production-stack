'use server';

import { type ActionResult, adminFetch, readError } from '@/lib/admin-api';
import { revalidatePath } from 'next/cache';

export type CreateStageInput = {
  slug: string;
  display_name: string;
  position: number;
  description?: string | null;
  goal?: string | null;
  max_followups?: number;
  is_terminal?: boolean;
};

export type StagePatch = {
  display_name?: string;
  description?: string | null;
  goal?: string | null;
  position?: number;
  max_followups?: number;
  is_terminal?: boolean;
  is_active?: boolean;
};

export async function createStage(
  tenantId: string,
  input: CreateStageInput,
): Promise<ActionResult> {
  const res = await adminFetch(`/tenants/${tenantId}/funnel-stages`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!res.ok) return { ok: false, error: await readError(res) };
  revalidatePath('/settings', 'layout');
  return { ok: true };
}

export async function updateStage(stageId: string, patch: StagePatch): Promise<ActionResult> {
  const res = await adminFetch(`/funnel-stages/${stageId}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
  if (!res.ok) return { ok: false, error: await readError(res) };
  revalidatePath('/settings', 'layout');
  return { ok: true };
}

export async function deleteStage(stageId: string): Promise<ActionResult> {
  const res = await adminFetch(`/funnel-stages/${stageId}`, { method: 'DELETE' });
  if (!res.ok) return { ok: false, error: await readError(res) };
  revalidatePath('/settings', 'layout');
  return { ok: true };
}
