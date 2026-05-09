import { z } from 'zod';

export const TurnCompletedSchema = z.object({
  turn_id: z.string().uuid(),
  status: z.enum(['completed', 'failed', 'cancelled']),
  response_text: z.string().nullable().optional(),
  input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative().optional(),
  cost_usd: z.number().nonnegative().optional(),
  model: z.string().optional(),
  prompt_version: z.string().optional(),
  n8n_execution_id: z.string().optional(),
  tools_used: z.array(z.string()).optional(),
  error: z.string().nullable().optional(),
});

export type TurnCompletedPayload = z.infer<typeof TurnCompletedSchema>;
