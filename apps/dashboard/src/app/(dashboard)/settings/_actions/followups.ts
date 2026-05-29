'use server';

import { type ActionResult, adminFetch, readError } from '@/lib/admin-api';
import { revalidatePath } from 'next/cache';

// ── Stage config (nurture_video_url / call_link) ─────────────────────────────
export async function updateStageConfig(
  stageId: string,
  patch: { nurture_video_url?: string | null; call_link?: string | null },
): Promise<ActionResult> {
  const res = await adminFetch(`/funnel-stages/${stageId}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
  if (!res.ok) return { ok: false, error: await readError(res) };
  revalidatePath('/settings', 'layout');
  return { ok: true };
}

// ── Followup templates ───────────────────────────────────────────────────────
type TemplatePatch = {
  delay_minutes?: number;
  text_template?: string | null;
  description?: string;
  type?: 'text' | 'flow' | 'content';
};

export async function updateTemplate(id: string, patch: TemplatePatch): Promise<ActionResult> {
  const res = await adminFetch(`/followup-templates/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
  if (!res.ok) return { ok: false, error: await readError(res) };
  revalidatePath('/settings', 'layout');
  return { ok: true };
}

// ── Followup messages ──────────────────────────────────────────────────────-─
type MessageBody = {
  message_type: 'text' | 'image';
  text_content?: string;
  media_url?: string;
  sort_order?: number;
  ai_image_context?: string;
};

export async function createMessage(templateId: string, body: MessageBody): Promise<ActionResult> {
  const res = await adminFetch(`/followup-templates/${templateId}/messages`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, error: await readError(res) };
  revalidatePath('/settings', 'layout');
  return { ok: true };
}

type MessagePatch = {
  text_content?: string | null;
  media_url?: string | null;
  ai_image_context?: string | null;
  sort_order?: number;
};

export async function updateMessage(id: string, patch: MessagePatch): Promise<ActionResult> {
  const res = await adminFetch(`/followup-messages/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
  if (!res.ok) return { ok: false, error: await readError(res) };
  revalidatePath('/settings', 'layout');
  return { ok: true };
}

export async function deleteMessage(id: string): Promise<ActionResult> {
  const res = await adminFetch(`/followup-messages/${id}`, { method: 'DELETE' });
  if (!res.ok) return { ok: false, error: await readError(res) };
  revalidatePath('/settings', 'layout');
  return { ok: true };
}

// Convierte una plantilla type='text' en 'content' al subir una imagen:
// 1) cambia el type (limpia text_template), 2) crea mensaje imagen (orden 0),
// 3) crea mensaje texto con el contenido actual (orden 1).
export async function convertTextToContent(
  templateId: string,
  mediaUrl: string,
  currentText: string,
): Promise<ActionResult> {
  const typeRes = await adminFetch(`/followup-templates/${templateId}`, {
    method: 'PUT',
    body: JSON.stringify({ type: 'content', text_template: null }),
  });
  if (!typeRes.ok) return { ok: false, error: await readError(typeRes) };

  const imgRes = await adminFetch(`/followup-templates/${templateId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ message_type: 'image', media_url: mediaUrl, sort_order: 0 }),
  });
  if (!imgRes.ok) return { ok: false, error: await readError(imgRes) };

  const txtRes = await adminFetch(`/followup-templates/${templateId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      message_type: 'text',
      text_content: currentText.trim() || ' ',
      sort_order: 1,
    }),
  });
  if (!txtRes.ok) return { ok: false, error: await readError(txtRes) };

  revalidatePath('/settings', 'layout');
  return { ok: true };
}
