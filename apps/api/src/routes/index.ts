import type { FastifyInstance } from 'fastify';
import agentResourcesRoutes from './admin/agent-resources.js';
import assetsRoutes from './admin/assets.js';
import followupMessagesRoutes from './admin/followup-messages.js';
import followupsRoutes from './admin/followups.js';
import loginRoute from './admin/login.js';
import setStageRoute from './admin/set-stage.js';
import systemEventRoute from './admin/system-event.js';
import tenantsRoutes from './admin/tenants.js';
import turnCompletedRoute from './admin/turn-completed.js';
import healthRoutes from './health.js';
import toolsRoutes from './tools.js';
import webhookManyChatRoute from './webhook-manychat.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
  await app.register(webhookManyChatRoute);
  await app.register(turnCompletedRoute);
  await app.register(setStageRoute);
  await app.register(systemEventRoute);
  await app.register(loginRoute);
  await app.register(tenantsRoutes);
  await app.register(followupsRoutes);
  await app.register(followupMessagesRoutes);
  await app.register(assetsRoutes);
  await app.register(agentResourcesRoutes);
  await app.register(toolsRoutes);
}
