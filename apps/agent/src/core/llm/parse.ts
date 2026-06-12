import type { LlmPlan } from '@dm-api/shared';
import { LlmPlanSchema } from '@dm-api/shared';
import type { Logger } from 'pino';

export interface ParseResult {
  plan: LlmPlan;
  retried: boolean;
}

export function parseLlmPlan(
  rawInput: unknown,
  log: Logger,
): { ok: true; plan: LlmPlan } | { ok: false; issues: string } {
  const result = LlmPlanSchema.safeParse(rawInput);
  if (result.success) {
    return { ok: true, plan: result.data };
  }
  const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  log.warn({ issues }, 'LLM plan parse failed');
  return { ok: false, issues };
}
