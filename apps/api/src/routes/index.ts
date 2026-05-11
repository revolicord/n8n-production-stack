import type { FastifyInstance } from 'fastify';
import turnCompletedRoute from './admin/turn-completed.js';
import healthRoutes from './health.js';
import toolsRoutes from './tools.js';
import webhookManyChatRoute from './webhook-manychat.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
  await app.register(webhookManyChatRoute);
  await app.register(turnCompletedRoute);
  await app.register(toolsRoutes);
}
