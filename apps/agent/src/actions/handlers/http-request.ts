import type { ActionResult } from '@dm-api/shared';
import { z } from 'zod';
import type { ActionInvocation } from '../../core/flow-engine/engine.js';
import type { ActionContext, ActionHandler } from '../registry.js';

const ConfigSchema = z.object({
  connector: z.string().min(1),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH']).default('POST'),
  url_ref: z.string().min(1),
  body: z.record(z.string(), z.unknown()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  timeout_ms: z.number().int().positive().default(15_000),
});

function renderTemplateStr(template: string, vars: Record<string, unknown>): string {
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

function resolveRef(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export const httpRequestHandler: ActionHandler = {
  type: 'http_request',
  configSchema: ConfigSchema,

  async execute(invocation: ActionInvocation, ctx: ActionContext): Promise<ActionResult> {
    const config = ConfigSchema.safeParse(invocation.config);
    if (!config.success) {
      return {
        command_type: 'HttpRequest',
        status: 'error',
        detail: { error: 'invalid config', issues: config.error.issues },
        attempts: 0,
      };
    }

    const { connector, method, url_ref, body, headers, timeout_ms } = config.data;

    const connectorConfig = ctx.tenantConfig.connectors?.[connector];
    if (!connectorConfig) {
      return {
        command_type: 'HttpRequest',
        status: 'error',
        detail: { error: `connector ${connector} not configured` },
        attempts: 1,
      };
    }

    const url = resolveRef(ctx.tenantConfig, url_ref) as string | undefined;
    if (!url) {
      return {
        command_type: 'HttpRequest',
        status: 'error',
        detail: { error: `url_ref ${url_ref} not resolved` },
        attempts: 1,
      };
    }

    if (ctx.dryRun) {
      return {
        command_type: 'HttpRequest',
        status: 'dry_run',
        detail: { url, method, connector },
        attempts: 0,
      };
    }

    const templateVars = {
      slots: ctx.subscriber.metadata ?? {},
    };

    const renderedBody = body
      ? JSON.parse(renderTemplateStr(JSON.stringify(body), templateVars))
      : undefined;

    try {
      const res = await fetch(url, {
        method,
        headers: {
          'content-type': 'application/json',
          ...headers,
        },
        body: renderedBody !== undefined ? JSON.stringify(renderedBody) : undefined,
        signal: AbortSignal.timeout(timeout_ms),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          command_type: 'HttpRequest',
          status: 'error',
          detail: { status: res.status, body: text.slice(0, 200) },
          attempts: 1,
        };
      }

      const responseBody = (await res.json().catch(() => null)) as unknown;

      return {
        command_type: 'HttpRequest',
        status: 'sent',
        detail: { status: res.status, result: responseBody, save_as: invocation.save_as },
        attempts: 1,
      };
    } catch (err) {
      return {
        command_type: 'HttpRequest',
        status: 'error',
        detail: { error: String(err) },
        attempts: 1,
      };
    }
  },
};
