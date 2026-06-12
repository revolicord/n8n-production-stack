import { z } from 'zod';
import { RepairPatternSchema, SlotValueSchema } from './commands.js';

export const FlowFrameSchema = z.object({
  flow_id: z.string(),
  flow_version: z.number().int().positive(),
  step_id: z.string(),
  frame_slots: z.record(z.string(), SlotValueSchema).default({}),
  started_at: z.string().datetime(),
  interrupted_at: z.string().datetime().nullable().default(null),
});
export type FlowFrame = z.infer<typeof FlowFrameSchema>;

export const DialogueStateSchema = z.object({
  version: z.literal(1),
  stack: z.array(FlowFrameSchema).default([]),
  slots: z.record(z.string(), SlotValueSchema).default({}),
  repair_context: z
    .object({
      pattern: RepairPatternSchema,
      since: z.string().datetime(),
      payload: z.record(z.string(), z.unknown()).default({}),
    })
    .nullable()
    .default(null),
  last_turn_id: z.string().uuid().nullable().default(null),
});
export type DialogueState = z.infer<typeof DialogueStateSchema>;
