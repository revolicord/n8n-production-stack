import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getConfig } from '../config.js';
import { verifyBearerToken } from './auth.js';

export async function verifyAdminAuth(
  req: FastifyRequest,
  _app: FastifyInstance,
): Promise<boolean> {
  const cfg = getConfig();
  // Camino 1: bearer estático (n8n, scripts internos)
  if (verifyBearerToken(req.headers.authorization, cfg.N8N_CALLBACK_TOKEN)) {
    return true;
  }
  // Camino 2: JWT con role:'admin' firmado por el proxy del dashboard Next.js
  // (apps/dashboard .../api/admin/[...path]) usando ADMIN_JWT_SECRET.
  try {
    const decoded = await req.jwtVerify<{ role?: string }>();
    return decoded.role === 'admin';
  } catch {
    return false;
  }
}
