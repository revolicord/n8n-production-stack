import { z } from 'zod';

export const SlotValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type SlotValue = z.infer<typeof SlotValueSchema>;

export const RepairPatternSchema = z.enum([
  'human_handoff',
  'cannot_handle',
  'continue_interrupted',
  'clarify',
  'correction',
]);
export type RepairPattern = z.infer<typeof RepairPatternSchema>;

const StartFlowCommand = z.object({
  type: z.literal('StartFlow'),
  flow_id: z.string().min(1),
  inputs: z.record(z.string(), SlotValueSchema).default({}),
  evidence: z.string().min(1),
});

const SetSlotCommand = z.object({
  type: z.literal('SetSlot'),
  slot: z.string().min(1),
  value: SlotValueSchema,
  evidence: z.string().min(1),
});

const CancelFlowCommand = z.object({
  type: z.literal('CancelFlow'),
  flow_id: z.string().optional(),
  reason: z.string().min(1),
});

const ClarifyCommand = z.object({
  type: z.literal('Clarify'),
  about: z.string().min(1),
  text: z.string().min(1).max(300),
});

const HumanHandoffCommand = z.object({
  type: z.literal('HumanHandoff'),
  kind: z.enum(['audio', 'keyword', 'media', 'agent']),
  reason: z.string().min(1),
  summary: z.string().optional(),
  source: z.enum(['code', 'llm']).default('llm'),
});

const ReplyTextCommand = z.object({
  type: z.literal('ReplyText'),
  text: z.string().min(1).max(500),
});

const SendContentCommand = z.object({
  type: z.literal('SendContent'),
  slug_id: z.string().min(1),
  evidence: z.string().min(1),
  lookup_stage: z.string().optional(),
});

const ChangeStageCommand = z.object({
  type: z.literal('ChangeStage'),
  to_stage: z.string().min(1),
  reason: z.string().nullable(),
  evidence: z.string().min(1),
  lead_in: z.string().max(200).optional(),
  cascade: z.boolean().default(true),
});

const ScheduleFollowupCommand = z.object({
  type: z.literal('ScheduleFollowup'),
  delay_minutes: z.number().int().positive(),
  note: z.string().optional(),
});

export const DialogueCommandSchema = z.discriminatedUnion('type', [
  StartFlowCommand,
  SetSlotCommand,
  CancelFlowCommand,
  ClarifyCommand,
  HumanHandoffCommand,
  ReplyTextCommand,
  SendContentCommand,
  ChangeStageCommand,
  ScheduleFollowupCommand,
]);
export type DialogueCommand = z.infer<typeof DialogueCommandSchema>;

// Subconjunto que el LLM puede emitir (ScheduleFollowup es solo del sistema/flows)
export const LlmCommandSchema = z.discriminatedUnion('type', [
  StartFlowCommand,
  SetSlotCommand,
  CancelFlowCommand,
  ClarifyCommand,
  HumanHandoffCommand,
  ReplyTextCommand,
  SendContentCommand,
  ChangeStageCommand,
]);
export type LlmCommand = z.infer<typeof LlmCommandSchema>;

export const LlmPlanSchema = z.object({
  reasoning: z.string().min(1),
  commands: z.array(LlmCommandSchema).max(6),
});
export type LlmPlan = z.infer<typeof LlmPlanSchema>;
