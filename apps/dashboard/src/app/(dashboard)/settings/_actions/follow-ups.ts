'use server';

import { type ActionResult, adminFetch, readError } from '@/lib/admin-api';
import { revalidatePath } from 'next/cache';

export type FollowupConfigPatch = {
  followups_enabled?: boolean;
  followup_reset_on_reply?: boolean;
  followup_window?: { timezone: string; start_hour: number; end_hour: number } | null;
};

export async function updateFollowupConfig(
  tenantId: string,
  patch: FollowupConfigPatch,
): Promise<ActionResult> {
  const res = await adminFetch(`/tenants/${tenantId}/config`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  if (!res.ok) return { ok: false, error: await readError(res) };
  revalidatePath('/settings', 'layout');
  return { ok: true };
}
