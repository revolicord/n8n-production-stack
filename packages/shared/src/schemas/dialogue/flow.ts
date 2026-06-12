import { z } from 'zod';
import { SlotValueSchema } from './commands.js';

export const ConditionSchema = z.object({
  slot: z.string().min(1),
  op: z.enum(['eq', 'neq', 'exists', 'not_exists', 'in', 'gte', 'lte']),
  value: z.union([SlotValueSchema, z.array(SlotValueSchema)]).optional(),
});
export type Condition = z.infer<typeof ConditionSchema>;

const StepBase = {
  id: z.string().min(1),
  next: z.string().optional(),
};

const CollectStep = z.object({
  ...StepBase,
  type: z.literal('collect'),
  slot: z.string().min(1),
  prompt_hint: z.string().min(1),
  validation: z.enum(['text', 'number', 'boolean', 'option']).default('text'),
  options: z.array(z.string()).optional(),
  skip_if_filled: z.boolean().default(true),
});

const ActionStep = z.object({
  ...StepBase,
  type: z.literal('action'),
  action: z.string().min(1),
  config: z.record(z.string(), z.unknown()).default({}),
  save_as: z.string().optional(),
  on_failure: z.enum(['abort', 'continue', 'handoff']).default('abort'),
});

const BranchStep = z.object({
  ...StepBase,
  type: z.literal('branch'),
  cases: z.array(z.object({ when: ConditionSchema, next: z.string().min(1) })).min(1),
  default: z.string().optional(),
});

const LinkStep = z.object({
  ...StepBase,
  type: z.literal('link'),
  flow_id: z.string().min(1),
});

export const FlowStepSchema = z.discriminatedUnion('type', [
  CollectStep,
  ActionStep,
  BranchStep,
  LinkStep,
]);
export type FlowStep = z.infer<typeof FlowStepSchema>;

export const FlowTriggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('llm'), description: z.string().min(1) }),
  z.object({
    type: z.literal('stage_transition'),
    from: z.string().min(1),
    to: z.string().min(1),
  }),
  z.object({ type: z.literal('system') }),
]);
export type FlowTrigger = z.infer<typeof FlowTriggerSchema>;

export const FlowDefinitionSchema = z.object({
  flow_id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(1),
  description: z.string().optional(),
  trigger: FlowTriggerSchema,
  slots: z
    .array(
      z.object({
        name: z.string().min(1),
        type: z.enum(['text', 'number', 'boolean', 'option']),
        description: z.string().optional(),
        options: z.array(z.string()).optional(),
      }),
    )
    .default([]),
  steps: z
    .array(FlowStepSchema)
    .min(1)
    .refine((s) => new Set(s.map((x) => x.id)).size === s.length, 'step ids must be unique'),
});
export type FlowDefinition = z.infer<typeof FlowDefinitionSchema>;
