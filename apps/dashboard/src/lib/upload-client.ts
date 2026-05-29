'use client';

// Sube un asset vía el proxy admin (/api/admin/assets/upload). El proxy reenvía
// el multipart intacto al API Fastify, que valida MIME + tamaño y guarda en MinIO.
// Devuelve la URL pública del asset.
export async function uploadAsset(file: File, tenantId: string): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`/api/admin/assets/upload?tenant_id=${tenantId}`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(body?.error?.message ?? `Error subiendo imagen (HTTP ${res.status})`);
  }
  const data = (await res.json()) as { url: string };
  return data.url;
}
