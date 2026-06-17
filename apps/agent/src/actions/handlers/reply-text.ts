import type { ActionResult } from '@dm-api/shared';
import { z } from 'zod';
import type { ActionInvocation } from '../../core/flow-engine/engine.js';
import type { ActionContext, ActionHandler } from '../registry.js';

const ConfigSchema = z.object({
  text: z.string().optional(),
  template: z.string().optional(),
  fallback: z.string().optional(),
});

function renderTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const parts = key.split('.');
    let current: unknown = vars;
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return `{${key}}`;
      current = (current as Record<string, unknown>)[part];
    }
    return current != null ? String(current) : `{${key}}`;
  });
}

export const replyTextHandler: ActionHandler = {
  type: 'reply_text',
  configSchema: ConfigSchema,

  async execute(invocation: ActionInvocation, ctx: ActionContext): Promise<ActionResult> {
    const config = ConfigSchema.safeParse(invocation.config);
    if (!config.success) {
      return {
        command_type: 'ReplyText',
        status: 'error',
        detail: { error: 'invalid config' },
        attempts: 0,
      };
    }

    let text: string | undefined;

    if (config.data.text) {
      text = config.data.text;
    } else if (config.data.template) {
      const templateVars: Record<string, unknown> = {
        lead_in: (invocation.config.lead_in as string | undefined) ?? '',
        tenant: {
          calendly_url: ctx.tenantConfig.calendly_url ?? '',
          connectors: ctx.tenantConfig.connectors ?? {},
        },
        subscriber: {
          display_name: ctx.subscriber.displayName ?? '',
          ig_username: ctx.subscriber.igUsername ?? '',
        },
      };
      text = renderTemplate(config.data.template, templateVars);
      if (!text || (text.includes('{') && text.includes('}'))) {
        text = config.data.fallback ?? text;
      }
    }

    if (!text) {
      return {
        command_type: 'ReplyText',
        status: 'skipped',
        detail: { reason: 'no_text' },
        attempts: 0,
      };
    }

    if (ctx.dryRun) {
      return {
        command_type: 'ReplyText',
        status: 'dry_run',
        detail: { text },
        attempts: 0,
      };
    }

    const result = await ctx.channel.sendText(text, ctx.subscriber.manychatSubscriberId);

    return {
      command_type: 'ReplyText',
      status: result.success ? 'sent' : 'error',
      detail: result.success
        ? { text, attempts: result.attempts }
        : { text, attempts: result.attempts, statusCode: result.statusCode },
      attempts: result.attempts,
    };
  },
};
