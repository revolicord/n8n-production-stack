import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyAdminAuth } from '../../lib/admin-auth.js';
import { isAllowedMimetype, uploadAsset } from '../../lib/minio.js';

const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 MB

export default async function assetsRoutes(app: FastifyInstance): Promise<void> {
  // POST /admin/assets/upload
  app.post<{ Querystring: { tenant_id?: string } }>('/admin/assets/upload', async (req, reply) => {
    if (!(await verifyAdminAuth(req, app))) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
    }

    const tenantIdParsed = z.string().uuid().safeParse(req.query.tenant_id);
    if (!tenantIdParsed.success) {
      return reply
        .code(400)
        .send({ error: { code: 'BAD_REQUEST', message: 'tenant_id UUID requerido' } });
    }
    const tenantId = tenantIdParsed.data;

    const data = await req.file({ limits: { fileSize: MAX_FILE_SIZE } });
    if (!data) {
      return reply
        .code(400)
        .send({ error: { code: 'BAD_REQUEST', message: 'campo file requerido' } });
    }

    const mimetype = data.mimetype;
    if (!isAllowedMimetype(mimetype)) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_MIMETYPE',
          message: `Tipo no permitido: ${mimetype}. Acepta: image/jpeg, image/png, image/webp, image/gif`,
        },
      });
    }

    const buffer = await data.toBuffer();
    if (buffer.byteLength > MAX_FILE_SIZE) {
      return reply.code(400).send({ error: { code: 'FILE_TOO_LARGE', message: 'Máximo 8 MB' } });
    }

    const url = await uploadAsset(buffer, data.filename, mimetype, tenantId);
    return reply.code(201).send({ url });
  });
}
