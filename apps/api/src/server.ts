import { randomUUID } from 'node:crypto';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { getConfig } from './config.js';
import { closeQueue } from './lib/queue.js';
import { closeRedis } from './lib/redis.js';
import { registerRoutes } from './routes/index.js';

async function main() {
  const config = getConfig();

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      base: { service: 'dm-api', env: config.NODE_ENV },
      redact: {
        paths: ['req.headers.authorization', 'req.headers["x-mc-token"]'],
        remove: false,
      },
      formatters: {
        level: (label: string) => ({ level: label }),
      },
    },
    bodyLimit: 1_000_000, // 1 MB
    genReqId: (req) => {
      const header = req.headers['x-correlation-id'];
      return typeof header === 'string' && header ? header : randomUUID();
    },
    requestIdHeader: 'x-correlation-id',
    requestIdLogLabel: 'correlation_id',
    disableRequestLogging: false,
    trustProxy: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false, // API JSON, no HTML
  });
  await app.register(multipart, {
    limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB max; validado también en la ruta
  });
  await app.register(sensible);

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-correlation-id', req.id);
    return payload;
  });

  await registerRoutes(app);

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ error: { code: 'NOT_FOUND', path: req.url } });
  });

  app.setErrorHandler((err, req, reply) => {
    req.log.error({ err }, 'unhandled error');
    if (reply.sent) return;
    const status = err.statusCode ?? 500;
    reply.code(status).send({
      error: {
        code: status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST',
        message: err.message,
      },
    });
  });

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  app.log.info({ port: config.PORT }, 'server started');

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      await closeQueue();
      await closeRedis();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'shutdown failed');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('boot failed', err);
  process.exit(1);
});
