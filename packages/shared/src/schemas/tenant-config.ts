import { z } from 'zod';

export const FlowEntrySchema = z.object({
  ns: z.string(),
  description: z.string(),
});

export const TenantConfigSchema = z
  .object({
    debounce_ms: z.number().int().positive().optional(),
    max_wait_ms: z.number().int().positive().optional(),
    lock_ttl_ms: z.number().int().positive().optional(),
    rate_per_minute: z.number().int().positive().optional(),
    buffer_hard_limit: z.number().int().positive().optional(),
    n8n_workflow_url: z.string().url().optional(),
    manychat_api_key: z.string().optional(),
    model: z.string().optional(),
    prompt_version: z.string().optional(),
    flows_by_stage: z.record(z.string(), z.array(FlowEntrySchema)).optional(),
  })
  .passthrough();

export type TenantConfig = z.infer<typeof TenantConfigSchema>;
export type FlowEntry = z.infer<typeof FlowEntrySchema>;
