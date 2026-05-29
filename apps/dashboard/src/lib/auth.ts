import { SignJWT, jwtVerify } from 'jose';

const jwtSecret = process.env.PANEL_JWT_SECRET ?? 'dev-secret-change-in-production';
const SECRET = new TextEncoder().encode(jwtSecret);
const ALG = 'HS256';

export const COOKIE_NAME = 'panel_session';
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 días

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

// Admin proxy: re-firma un JWT corto con ADMIN_JWT_SECRET (mismo secreto que el
// API Fastify) para autenticarse contra los endpoints /admin/*. role:'admin' es
// lo que verifyAdminAuth del API espera. TTL corto: el token solo vive el tiempo
// de un request proxeado.
const adminJwtSecret = process.env.ADMIN_JWT_SECRET ?? 'dev-secret-change-in-production';
const ADMIN_SECRET = new TextEncoder().encode(adminJwtSecret);

export async function signAdminToken(): Promise<string> {
  return new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(ADMIN_SECRET);
}

// Pure-JS timing-safe comparison — works in Edge Runtime and Node.js
export function safeEqualString(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}
