'use server';

import { type ActionResult, adminFetch, readError } from '@/lib/admin-api';
import { revalidatePath } from 'next/cache';

export type AgenteConfigPatch = {
  persona_prompt?: string;
  skeleton_prompt?: string;
  calendly_url?: string;
  nurturing_video_url?: string;
  disqualification_reasons?: string[];
};

export async function updateAgenteConfig(
  tenantId: string,
  patch: AgenteConfigPatch,
): Promise<ActionResult> {
  const res = await adminFetch(`/tenants/${tenantId}/config`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  if (!res.ok) return { ok: false, error: await readError(res) };
  revalidatePath('/settings', 'layout');
  return { ok: true };
}
