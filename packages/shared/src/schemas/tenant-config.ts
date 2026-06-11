import { z } from 'zod';

/** Acción por content_class: escalar a humano, anotar (agente sigue), o que el agente maneje. */
export const MediaPolicyActionSchema = z.enum(['escalate', 'annotate', 'agent']);
export type MediaPolicyAction = z.infer<typeof MediaPolicyActionSchema>;

/**
 * Override por tenant de la matriz de medios (default = allowlist en código).
 * Keyed por content_class (text/audio/image/...); claves desconocidas se ignoran.
 */
export const MediaPolicySchema = z.record(z.string(), MediaPolicyActionSchema);
export type MediaPolicy = z.infer<typeof MediaPolicySchema>;

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
    // Override de la matriz de escalado por content_class (default = allowlist en código)
    media_policy: MediaPolicySchema.optional(),
  })
  .passthrough();

export type TenantConfig = z.infer<typeof TenantConfigSchema>;
