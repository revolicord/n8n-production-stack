'use server';

import { type ActionResult, adminFetch, readError } from '@/lib/admin-api';
import { revalidatePath } from 'next/cache';

export type CreateFlowInput = {
  stage_id: string;
  flow_ns: string;
  human_name: string;
  media_type?: string | null;
  slug_id?: string | null;
  content_description?: string | null;
  usage_condition?: string | null;
};

export type FlowPatch = {
  human_name?: string;
  content_description?: string | null;
  usage_condition?: string | null;
  media_type?: string | null;
  slug_id?: string | null;
  is_active?: boolean;
};

export async function createFlow(tenantId: string, input: CreateFlowInput): Promise<ActionResult> {
  const res = await adminFetch(`/tenants/${tenantId}/stage-flows`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!res.ok) return { ok: false, error: await readError(res) };
  revalidatePath('/settings/flows');
  return { ok: true };
}

export async function updateFlow(id: string, patch: FlowPatch): Promise<ActionResult> {
  const res = await adminFetch(`/stage-flows/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
  if (!res.ok) return { ok: false, error: await readError(res) };
  revalidatePath('/settings/flows');
  return { ok: true };
}

export async function deleteFlow(id: string): Promise<ActionResult> {
  const res = await adminFetch(`/stage-flows/${id}`, { method: 'DELETE' });
  if (!res.ok) return { ok: false, error: await readError(res) };
  revalidatePath('/settings/flows');
  return { ok: true };
}
