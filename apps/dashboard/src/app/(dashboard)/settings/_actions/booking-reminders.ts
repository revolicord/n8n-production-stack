'use server';

import { type ActionResult, adminFetch, readError } from '@/lib/admin-api';
import { revalidatePath } from 'next/cache';

export type CreateBookingReminderInput = {
  offset_minutes: number;
  kind?: 'reminder' | 'no_show';
  type: 'text' | 'flow';
  text_template?: string;
  flow_ns?: string;
  description?: string;
  sort_order?: number;
};

export type BookingReminderPatch = {
  offset_minutes?: number;
  kind?: 'reminder' | 'no_show';
  type?: 'text' | 'flow';
  text_template?: string | null;
  flow_ns?: string | null;
  description?: string | null;
  is_active?: boolean;
  sort_order?: number;
};

export async function createBookingReminder(
  tenantId: string,
  input: CreateBookingReminderInput,
): Promise<ActionResult> {
  const res = await adminFetch(`/tenants/${tenantId}/booking-reminders`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!res.ok) return { ok: false, error: await readError(res) };
  revalidatePath('/settings', 'layout');
  return { ok: true };
}

export async function updateBookingReminder(
  id: string,
  patch: BookingReminderPatch,
): Promise<ActionResult> {
  const res = await adminFetch(`/booking-reminders/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
  if (!res.ok) return { ok: false, error: await readError(res) };
  revalidatePath('/settings', 'layout');
  return { ok: true };
}

export async function deleteBookingReminder(id: string): Promise<ActionResult> {
  const res = await adminFetch(`/booking-reminders/${id}`, { method: 'DELETE' });
  if (!res.ok) return { ok: false, error: await readError(res) };
  revalidatePath('/settings', 'layout');
  return { ok: true };
}
