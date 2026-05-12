import { z } from 'zod';

export const N8nDispatchMessageSchema = z.object({
  id: z.string().uuid(),
  external_message_id: z.string().nullable(),
  text: z.string().nullable(),
  reply_type: z.string().nullable(),
  ts: z.number(),
  media_urls: z.array(z.string()).default([]),
});

export const N8nDispatchPayloadSchema = z.object({
  schema_version: z.literal('v1'),
  turn_id: z.string().uuid(),
  callback_url: z.string().url(),
  callback_token: z.string(),
  tenant: z.object({
    id: z.string().uuid(),
    slug: z.string(),
    config: z.record(z.string(), z.unknown()),
  }),
  subscriber: z.object({
    id: z.string().uuid(),
    manychat_subscriber_id: z.string(),
    ig_user_id: z.string().nullable(),
    ig_username: z.string().nullable(),
    display_name: z.string().nullable(),
    locale: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).default({}),
    lead_stage: z.string().default('nuevo'),
  }),
  conversation: z.object({
    id: z.string().uuid(),
    opened_at: z.string(),
  }),
  messages: z.array(N8nDispatchMessageSchema),
  trigger: z
    .object({
      source: z.string().nullable(),
      channel: z.string().nullable(),
    })
    .optional(),
});

export type N8nDispatchPayload = z.infer<typeof N8nDispatchPayloadSchema>;
export type N8nDispatchMessage = z.infer<typeof N8nDispatchMessageSchema>;
