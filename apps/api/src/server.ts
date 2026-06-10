import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
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

  // API JSON-only: el panel admin vive en el dashboard Next.js (dashboard.revolicord.com).
  // CSP estricta — esta superficie nunca renderiza HTML ni se embebe en frames.
  // Excepción: /docs (Swagger UI) sirve HTML+JS y usa su propio CSP (staticCSP).
  await app.register(helmet, { global: false });
  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/docs' || req.url.startsWith('/docs/')) return;
    await reply.helmet({
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
    });
  });
  await app.register(cors, {
    // En producción: mismo origen (el dashboard se sirve desde el mismo Fastify).
    // En desarrollo: refleja el Origin recibido para permitir localhost:8787 u otro puerto.
    origin: config.NODE_ENV !== 'production',
    credentials: true,
  });
  await app.register(jwt, {
    secret: config.ADMIN_JWT_SECRET,
    sign: { expiresIn: '12h' },
  });
  await app.register(multipart, {
    limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB max; validado también en la ruta
  });
  await app.register(sensible);

  // OpenAPI (ADR-0022): spec generado desde las rutas; UI interactiva en /docs,
  // spec crudo en /docs/json. Los schemas son solo documentación (ver lib/openapi.ts).
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'DM Setter API',
        description:
          'API entre ManyChat/Telegram y los workflows de n8n: debounce, locks, turnos, ' +
          'escalado a humano y administración del funnel. Los endpoints /admin/* aceptan ' +
          'bearer estático (N8N_CALLBACK_TOKEN) o JWT admin del dashboard.',
        version: '0.0.1',
      },
      servers: [{ url: '/', description: 'Mismo origen' }],
      tags: [
        { name: 'health', description: 'Liveness / readiness' },
        { name: 'webhooks', description: 'Entradas externas (ManyChat, Telegram)' },
        { name: 'admin/leads', description: 'Acciones sobre leads (n8n + dashboard)' },
        { name: 'admin/notifications', description: 'Notificaciones de escalado a humano' },
        {
          name: 'admin/followups',
          description: 'Funnel stages, templates y mensajes de follow-up',
        },
        { name: 'admin/agent-resources', description: 'Recursos de cierre/objeción del agente' },
        { name: 'admin/misc', description: 'Tenants, assets y callbacks de turno' },
        { name: 'tools', description: 'Catálogo de flows ManyChat para n8n' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            description: 'N8N_CALLBACK_TOKEN estático o JWT con role=admin (ADMIN_JWT_SECRET)',
          },
          mcToken: {
            type: 'apiKey',
            in: 'header',
            name: 'x-mc-token',
            description: 'MC_WEBHOOK_TOKEN compartido con ManyChat',
          },
          telegramSecret: {
            type: 'apiKey',
            in: 'header',
            name: 'x-telegram-bot-api-secret-token',
            description: 'Secreto configurado en setWebhook de Telegram',
          },
        },
      },
    },
  });
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    staticCSP: true,
    uiConfig: { docExpansion: 'list', deepLinking: true, persistAuthorization: true },
  });

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
