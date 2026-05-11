import { z } from 'zod';

export const ManyChatMediaSchema = z.object({
  type: z.enum(['image', 'video', 'audio', 'file']),
  url: z.string().url(),
});

export const ManyChatSubscriberSchema = z.object({
  manychat_id: z.string().min(1),
  ig_user_id: z.string().optional(),
  ig_username: z.string().optional(),
  ig_page_name: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  full_name: z.string().optional(),
  name: z.string().optional(),
  locale: z.string().optional(),
  subscribed_at: z.string().optional(),
});

export const ManyChatMessageSchema = z.object({
  id: z.string().min(1).optional(),
  text: z.string().default(''),
  timestamp: z.number().optional(),
  reply_type: z.string().optional(),
  media: z.array(ManyChatMediaSchema).default([]),
});

export const ManyChatTriggerSchema = z.object({
  source: z.string().optional(),
  channel: z.string().optional(),
  ref: z.string().optional(),
});

export const ManyChatInstagramContextSchema = z.object({
  messaging_window: z.string().optional(),
  last_interaction: z.string().optional(),
  last_seen: z.string().optional(),
  opt_in: z.string().optional(),
  follows_you: z.string().optional(),
  followers_count: z.string().optional(),
  verified: z.string().optional(),
});

export const ManyChatWebhookSchema = z.object({
  tenant_slug: z.string().min(1),
  subscriber: ManyChatSubscriberSchema,
  message: ManyChatMessageSchema,
  trigger: ManyChatTriggerSchema.optional(),
  instagram_context: ManyChatInstagramContextSchema.optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

export type ManyChatWebhookEvent = z.infer<typeof ManyChatWebhookSchema>;
export type ManyChatSubscriberPayload = z.infer<typeof ManyChatSubscriberSchema>;
export type ManyChatMessagePayload = z.infer<typeof ManyChatMessageSchema>;
export type ManyChatInstagramContext = z.infer<typeof ManyChatInstagramContextSchema>;
