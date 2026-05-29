import 'server-only';
import { signAdminToken } from '@/lib/auth';

// Base del API Fastify interno. En producción docker-stack inyecta
// http://n8n_api:3000; en dev local el API corre en localhost:3000 (pnpm dev:api).
export const INTERNAL_API_URL = process.env.INTERNAL_API_URL ?? 'http://127.0.0.1:3000';

// Llamada autenticada a los endpoints /admin/* del API. Re-firma un JWT corto con
// ADMIN_JWT_SECRET (role:'admin'). Pensada para usarse desde Server Actions.
export async function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await signAdminToken();
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return fetch(`${INTERNAL_API_URL}/admin${path}`, { ...init, headers, cache: 'no-store' });
}

export type ActionResult = { ok: true } | { ok: false; error: string };

// Extrae un mensaje legible de la respuesta de error del API
// (shape: { error: { code, message?, details?[] } }).
export async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string; details?: { message?: string }[] };
  } | null;
  const err = body?.error;
  if (!err) return `HTTP ${res.status}`;
  if (err.message) return err.message;
  const detail = err.details?.find((d) => d.message)?.message;
  if (detail) return detail;
  return err.code ?? `HTTP ${res.status}`;
}
