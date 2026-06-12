import type { DbClient, Subscriber, Tenant } from '@dm-api/db';
import type { ActionResult, TenantConfig } from '@dm-api/shared';
import type { Logger } from 'pino';
import type { z } from 'zod';
import type { ChannelAdapter } from '../channel/types.js';
import type { StageContentCatalog } from '../core/context/assemble.js';
import type { ActionInvocation } from '../core/flow-engine/engine.js';

export interface ActionContext {
  tenant: Tenant;
  tenantConfig: TenantConfig;
  subscriber: Subscriber;
  conversationId: string;
  turnId: string;
  channel: ChannelAdapter;
  db: DbClient;
  redis: import('ioredis').Redis;
  log: Logger;
  dryRun: boolean;
  stageCatalog: StageContentCatalog[];
  currentStage: string;
}

export interface ActionHandler {
  readonly type: string;
  readonly configSchema: z.ZodTypeAny;
  execute(invocation: ActionInvocation, ctx: ActionContext): Promise<ActionResult>;
}

export class ActionRegistry {
  private readonly handlers = new Map<string, ActionHandler>();

  register(handler: ActionHandler): void {
    this.handlers.set(handler.type, handler);
  }

  get(type: string): ActionHandler | undefined {
    return this.handlers.get(type);
  }
}
