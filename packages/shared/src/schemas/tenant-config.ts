import { z } from 'zod';

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
    calendly_url: z.string().optional(),
    // Escalado a humano: chat de Telegram por tenant (fallback: TELEGRAM_DEFAULT_CHAT_ID)
    telegram_chat_id: z.string().optional(),
    // Frases que disparan notificación kind='keyword' (match case-insensitive por substring)
    notification_keywords: z.array(z.string()).optional(),
  })
  .passthrough();

export type TenantConfig = z.infer<typeof TenantConfigSchema>;
