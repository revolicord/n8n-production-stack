import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getConfig } from '../../config.js';

export const LoginBodySchema = z.object({
  password: z.string().min(1),
});

function safeEqualString(a: string, b: string): boolean {
  const aLen = Buffer.byteLength(a);
  const bLen = Buffer.byteLength(b);
  // timingSafeEqual requiere misma longitud; si difieren, falla en tiempo constante igual
  const aBytes = Buffer.alloc(Math.max(aLen, bLen)).fill(0);
  const bBytes = Buffer.alloc(Math.max(aLen, bLen)).fill(0);
  Buffer.from(a).copy(aBytes);
  Buffer.from(b).copy(bBytes);
  return timingSafeEqual(aBytes, bBytes) && aLen === bLen;
}

export default async function loginRoute(app: FastifyInstance): Promise<void> {
  const config = getConfig();

  app.post('/admin/login', async (req, reply) => {
    const parsed = LoginBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'INVALID_PAYLOAD' } });
    }
    if (!safeEqualString(parsed.data.password, config.ADMIN_PASSWORD)) {
      await new Promise((r) => setTimeout(r, 250));
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
    }
    const token = app.jwt.sign({ role: 'admin' });
    return reply.code(200).send({ token, expires_in: 12 * 3600 });
  });
}
