import { COOKIE_MAX_AGE, COOKIE_NAME, createPanelSession, safeEqualString } from '@/lib/auth';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const LoginSchema = z.object({ password: z.string().min(1) });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const expected = process.env.PANEL_PASSWORD;
  if (!expected || expected.length < 8) {
    return NextResponse.json({ error: 'panel_misconfigured' }, { status: 500 });
  }

  if (!safeEqualString(parsed.data.password, expected)) {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  const token = await createPanelSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}
