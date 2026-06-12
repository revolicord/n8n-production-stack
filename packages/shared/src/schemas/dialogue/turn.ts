import { z } from 'zod';
import { N8nDispatchMessageSchema } from '../n8n-dispatch.js';
import { DialogueCommandSchema } from './commands.js';
import { DialogueStateSchema } from './state.js';

export const TurnTriggerSchema = z.object({
  source: z.enum(['lead_message', 'system_followup', 'system_event', 'human_echo']),
  channel: z.string().default('instagram'),
});
export type TurnTrigger = z.infer<typeof TurnTriggerSchema>;

export const TurnInputSchema = z.object({
  schema_version: z.literal('v1'),
  turn_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  subscriber_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  trigger: TurnTriggerSchema,
  messages: z.array(N8nDispatchMessageSchema),
  system_commands: z.array(DialogueCommandSchema).default([]),
  dry_run: z.boolean().default(false),
});
export type TurnInput = z.infer<typeof TurnInputSchema>;

export const ActionResultSchema = z.object({
  command_type: z.string(),
  status: z.enum(['sent', 'changed', 'noted', 'scheduled', 'skipped', 'error', 'dry_run']),
  detail: z.record(z.string(), z.unknown()).default({}),
  attempts: z.number().int().default(1),
});
export type ActionResult = z.infer<typeof ActionResultSchema>;

export const AgentResponseSchema = z.object({
  turn_id: z.string().uuid(),
  status: z.enum(['completed', 'interrupted', 'failed', 'dry_run']),
  commands: z.array(DialogueCommandSchema),
  action_results: z.array(ActionResultSchema),
  response_texts: z.array(z.string()),
  final_stage: z.string(),
  dialogue_state: DialogueStateSchema,
  interrupt: z
    .object({
      reason: z.string(),
      notification_id: z.string().uuid(),
    })
    .optional(),
  metrics: z.object({
    model: z.string().nullable(),
    input_tokens: z.number().int().nullable(),
    output_tokens: z.number().int().nullable(),
    llm_ms: z.number().int().nullable(),
    total_ms: z.number().int(),
  }),
});
export type AgentResponse = z.infer<typeof AgentResponseSchema>;
