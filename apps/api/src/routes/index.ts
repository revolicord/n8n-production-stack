import type { FastifyInstance } from 'fastify';
import followupsRoutes from './admin/followups.js';
import setStageRoute from './admin/set-stage.js';
import turnCompletedRoute from './admin/turn-completed.js';
import healthRoutes from './health.js';
import toolsRoutes from './tools.js';
import webhookManyChatRoute from './webhook-manychat.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
  await app.register(webhookManyChatRoute);
  await app.register(turnCompletedRoute);
  await app.register(setStageRoute);
  await app.register(followupsRoutes);
  await app.register(toolsRoutes);
}
