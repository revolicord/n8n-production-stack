'use server';

import { type ActionResult, adminFetch, readError } from '@/lib/admin-api';
import { revalidatePath } from 'next/cache';

// Genera un slug a partir del nombre visible (igual que hacía el SPA legacy).
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '');
}

export async function createResource(
  tenantId: string,
  category: string,
  displayName: string,
): Promise<ActionResult> {
  const name = displayName.trim();
  if (!name) return { ok: false, error: 'El nombre es obligatorio' };
  const slug = slugify(name) || `recurso-${Date.now()}`;
  const res = await adminFetch(`/tenants/${tenantId}/agent-resources`, {
    method: 'POST',
    body: JSON.stringify({ category, slug, display_name: name, text_content: ' ' }),
  });
  if (!res.ok) return { ok: false, error: await readError(res) };
  revalidatePath('/settings', 'layout');
  return { ok: true };
}

type ResourcePatch = {
  display_name?: string;
  trigger_hint?: string | null;
  text_content?: string | null;
  media_url?: string | null;
  config?: Record<string, unknown> | null;
};

export async function updateResource(id: string, patch: ResourcePatch): Promise<ActionResult> {
  const res = await adminFetch(`/agent-resources/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
  if (!res.ok) return { ok: false, error: await readError(res) };
  revalidatePath('/settings', 'layout');
  return { ok: true };
}

export async function deleteResource(id: string): Promise<ActionResult> {
  const res = await adminFetch(`/agent-resources/${id}`, { method: 'DELETE' });
  if (!res.ok) return { ok: false, error: await readError(res) };
  revalidatePath('/settings', 'layout');
  return { ok: true };
}
