# 07 — Autenticación y variables de entorno

## Modelo de auth

**Single password + JWT en cookie httpOnly.** Sin usuarios, sin roles, sin RBAC. Es un panel personal para Alex (y los futuros clientes one-tenant-one-user).

Razones:

- El usuario decidió explícitamente "auth más simple" que el SPA admin.
- Single tenant en uso, single usuario.
- Reducir superficie de ataque y mantenimiento.

## Flujo de login

```
1. Usuario visita dashboard.revolicord.com
2. Middleware ve que no hay cookie `panel_session` → redirect a /login
3. /login muestra formulario con un solo campo: password
4. POST /api/auth/login con { password }
5. Endpoint compara con timingSafeEqual contra PANEL_PASSWORD
6. Si OK: genera JWT, setea cookie httpOnly `panel_session`, devuelve { ok: true }
7. UI redirect a /
8. Middleware ve cookie válida → permite
```

## Variables de entorno

Una sola fuente: `.env` en la raíz de `apps/dashboard/`. En producción, vienen del `docker-stack.yml`.

| Variable | Tipo | Default dev | Descripción |
|---|---|---|---|
| `DATABASE_URL` | string | `postgres://postgres:postgres@localhost:5432/n8n` | URL de Postgres. Mismo que la API Fastify. |
| `PANEL_PASSWORD` | string ≥ 8 chars | `changeme` | Contraseña de Alex |
| `PANEL_JWT_SECRET` | hex 32+ bytes | `openssl rand -hex 32` | Secret de JWT, INDEPENDIENTE de `ADMIN_JWT_SECRET` |
| `NODE_ENV` | string | `development` | Se setea automáticamente |

**`.env.example`** (debe quedar commiteado):

```
# Postgres (mismo que la API Fastify)
DATABASE_URL=postgres://postgres:postgres@localhost:5432/n8n

# Auth del panel (SEPARADO del SPA admin)
PANEL_PASSWORD=changeme-please
PANEL_JWT_SECRET=replace-with-openssl-rand-hex-32
```

**`.gitignore`** del paquete:

```
.env
.env.local
.env.production
.next/
node_modules/
*.log
```

## Implementación detallada

### `src/lib/auth.ts`

```ts
import { SignJWT, jwtVerify } from 'jose';
import { timingSafeEqual } from 'node:crypto';

const SECRET = new TextEncoder().encode(process.env.PANEL_JWT_SECRET!);
const ALG = 'HS256';
const COOKIE_NAME = 'panel_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 días

export { COOKIE_NAME, COOKIE_MAX_AGE };

export async function createPanelSession(): Promise<string> {
  return new SignJWT({ kind: 'panel' })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(SECRET);
}

export async function verifyPanelSession(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, SECRET, { algorithms: [ALG] });
    return true;
  } catch {
    return false;
  }
}

export function safeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
```

### `src/app/api/auth/login/route.ts`

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createPanelSession, safeEqualString, COOKIE_NAME, COOKIE_MAX_AGE } from '@/lib/auth';

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
```

> Notar que `zod` debe estar instalado. Si no está en `package.json`, añadirlo (`pnpm add zod` desde `apps/dashboard/`).

### `src/app/api/auth/logout/route.ts`

```ts
import { NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/auth';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(COOKIE_NAME);
  return res;
}
```

### `src/app/login/page.tsx`

```tsx
'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      setError('Contraseña incorrecta');
      return;
    }
    startTransition(() => router.push('/'));
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-qc-bg">
      <div className="bg-qc-surface border border-qc-border rounded-xl p-8 w-full max-w-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-8 h-8 bg-qc-teal700 rounded-md flex items-center justify-center">
            {/* logo o icono */}
          </div>
          <h1 className="text-base font-medium text-white">Quantum Dashboard</h1>
        </div>
        <form onSubmit={onSubmit}>
          <label className="block text-xs text-qc-textMuted mb-1">
            Contraseña
          </label>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-qc-bg border border-qc-borderHover rounded px-3 py-2 text-sm text-white focus:border-qc-teal500 focus:outline-none mb-3"
            placeholder="••••••••"
            required
          />
          {error && (
            <p className="text-xs text-qc-danger mb-3">{error}</p>
          )}
          <button
            type="submit"
            disabled={isPending}
            className="w-full bg-qc-teal700 hover:bg-qc-teal500 text-white font-medium rounded py-2 text-sm transition-colors disabled:opacity-60"
          >
            {isPending ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

### `src/middleware.ts`

Ya cubierto en doc 06. Repetido aquí por completitud:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { verifyPanelSession, COOKIE_NAME } from '@/lib/auth';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Excluir rutas que no requieren auth
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.svg'
  ) {
    return NextResponse.next();
  }
  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  const valid = cookie ? await verifyPanelSession(cookie) : false;
  if (!valid) {
    const loginUrl = new URL('/login', req.url);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
```

## Botón de logout

En `Sidebar.tsx`, el botón inferior:

```tsx
async function handleLogout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
}
```

## Setup local (paso a paso)

```bash
# Desde la raíz del repo
cd apps/dashboard

# 1. Copiar env
cp .env.example .env

# 2. Generar el JWT secret
openssl rand -hex 32   # copiar el resultado a PANEL_JWT_SECRET en .env

# 3. Setear una password
# Editar .env y poner PANEL_PASSWORD=mi-password-segura

# 4. Instalar deps (desde raíz, con pnpm workspaces)
cd ../..
pnpm install

# 5. Verificar que la API y Postgres están corriendo (mismo DATABASE_URL)
# Si la API Fastify ya funciona en dev, Postgres también.

# 6. Arrancar el panel
cd apps/dashboard
pnpm dev

# Abrir http://localhost:3001
# Login con la password definida
```

## Setup en producción

Variables a añadir en el `.env` de producción del stack (NO commitear):

```
PANEL_PASSWORD=<lo elige Alex, mínimo 8 chars>
PANEL_JWT_SECRET=<openssl rand -hex 32>
```

Luego:

```bash
make deploy   # redespliega el stack con el nuevo servicio
```

Ver doc 11 para el `docker-stack.yml` completo.

## Seguridad: lo que SÍ está cubierto

- ✅ Password comparada con `timingSafeEqual` (resistente a timing attacks).
- ✅ JWT firmado HMAC-SHA256, expira en 30 días.
- ✅ Cookie httpOnly (JS del cliente no puede leerla).
- ✅ Cookie `secure` en producción (solo HTTPS).
- ✅ Cookie `sameSite: 'lax'` (mitiga CSRF).
- ✅ Rutas protegidas vía middleware (no se puede saltar).
- ✅ Secret distinto del SPA admin (no se invalidan sesiones unas a otras).

## Seguridad: lo que NO está cubierto (intencionalmente)

- ❌ Rate limiting en `/api/auth/login` (mitigación pendiente — pero como solo un usuario, riesgo bajo).
- ❌ MFA / 2FA.
- ❌ Lockout tras N fallos.
- ❌ CSRF token (sameSite lax cubre el grueso).
- ❌ Refresh tokens / sliding sessions (al expirar, login otra vez).
- ❌ Auditoría de accesos (logs simples a stdout sí, persistente no).

Estos quedan documentados como deuda técnica en doc 13.

Fin del documento 07.
