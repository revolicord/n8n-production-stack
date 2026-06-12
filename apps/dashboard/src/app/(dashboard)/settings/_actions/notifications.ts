'use server';

import { type ActionResult, adminFetch, readError } from '@/lib/admin-api';
import type { MediaPolicy } from '@dm-api/shared';
import { revalidatePath } from 'next/cache';

export type NotificationConfigPatch = {
  notification_keywords?: string[];
  media_policy?: MediaPolicy;
};

export async function updateNotificationConfig(
  tenantId: string,
  patch: NotificationConfigPatch,
): Promise<ActionResult> {
  const res = await adminFetch(`/tenants/${tenantId}/config`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  if (!res.ok) return { ok: false, error: await readError(res) };
  revalidatePath('/settings', 'layout');
  return { ok: true };
}
