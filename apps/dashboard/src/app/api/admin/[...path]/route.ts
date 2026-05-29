import { COOKIE_NAME, signAdminToken, verifyPanelSession } from '@/lib/auth';
import { type NextRequest, NextResponse } from 'next/server';

// Proxy genérico hacia los endpoints /admin/* del API Fastify.
// - Valida la cookie panel_session (sesión del dashboard Next).
// - Re-firma un JWT corto con ADMIN_JWT_SECRET (role:'admin') que el API verifica.
// - Reenvía método, path, query, body (incluido multipart) y devuelve la respuesta tal cual.
//
// El navegador nunca ve el token de admin; solo su cookie de sesión del panel.

// En producción docker-stack inyecta http://n8n_api:3000; en dev local el API
// Fastify corre en localhost:3000 (pnpm dev:api).
const INTERNAL_API_URL = process.env.INTERNAL_API_URL ?? 'http://127.0.0.1:3000';

async function handle(req: NextRequest, path: string[]): Promise<NextResponse> {
  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  if (!cookie || !(await verifyPanelSession(cookie))) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  }

  const adminToken = await signAdminToken();
  const target = `${INTERNAL_API_URL}/admin/${path.join('/')}${req.nextUrl.search}`;

  const headers = new Headers();
  headers.set('authorization', `Bearer ${adminToken}`);
  const contentType = req.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  const correlationId = req.headers.get('x-correlation-id');
  if (correlationId) headers.set('x-correlation-id', correlationId);

  const method = req.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';
  // Leemos el body completo (límite 8 MB en uploads) en vez de hacer streaming:
  // evita el manejo de `duplex: 'half'` y es suficiente para el tamaño esperado.
  const body = hasBody ? await req.arrayBuffer() : undefined;

  const upstream = await fetch(target, {
    method,
    headers,
    body,
    redirect: 'manual',
  });

  const respHeaders = new Headers();
  const upstreamContentType = upstream.headers.get('content-type');
  if (upstreamContentType) respHeaders.set('content-type', upstreamContentType);

  // 204/205 no llevan body
  if (upstream.status === 204 || upstream.status === 205) {
    return new NextResponse(null, { status: upstream.status, headers: respHeaders });
  }

  const buf = await upstream.arrayBuffer();
  return new NextResponse(buf, { status: upstream.status, headers: respHeaders });
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  return handle(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  return handle(req, (await ctx.params).path);
}
export async function PUT(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  return handle(req, (await ctx.params).path);
}
export async function DELETE(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  return handle(req, (await ctx.params).path);
}
export async function PATCH(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  return handle(req, (await ctx.params).path);
}
