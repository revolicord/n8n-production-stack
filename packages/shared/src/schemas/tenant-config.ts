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

/**
 * Política de respuesta por etapa (regla de negocio "camino feliz sin texto del LLM").
 * - 'flow_only': en el camino feliz el agente NO emite texto improvisado (ReplyText/Clarify
 *   con origin:'command'). Solo salen contenidos (send_content) y textos *scripted* de flow
 *   (reply_text con origin:'flow', p. ej. el link de Calendly o el video de nurturing). El
 *   texto improvisado del LLM solo sobrevive ante un desvío (cuando el turno NO avanzó por
 *   flow/contenido), para nunca dejar al lead en visto.
 * - 'text_ok': comportamiento clásico, el LLM puede acompañar con texto libre.
 */
export const StageTextPolicySchema = z.enum(['flow_only', 'text_ok']);
export type StageTextPolicy = z.infer<typeof StageTextPolicySchema>;

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
    // ADR-0024: motor de diálogo — flag de cutover por tenant
    engine: z.enum(['n8n', 'agent']).optional(),
    // ADR-0024: shadow mode — corre el agente en dry-run en paralelo al camino n8n
    shadow_agent: z.boolean().optional(),
    // ADR-0024: bloque de persona del tenant (editable en /settings)
    persona_prompt: z.string().optional(),
    // Esqueleto de plataforma editable por tenant. Si no está definido se usa el
    // PLATFORM_SKELETON hardcodeado en apps/agent/src/core/llm/prompt.ts.
    // Debe incluir los placeholders {VALID_TRANSITIONS} y {CONTENT_OPTIONS}.
    skeleton_prompt: z.string().optional(),
    // Regla de negocio "nunca dejar al lead sin respuesta": texto de último recurso que
    // el guardrail envía si un turno no produjo ningún mensaje visible (ni ReplyText ni
    // SendContent). Editable por tenant; si no se define se usa un default neutro.
    no_reply_fallback_text: z.string().optional(),
    // ADR-0024: razones de descalificación válidas para ChangeStage (datos del tenant)
    disqualification_reasons: z.array(z.string()).optional(),
    // ADR-0024: conectores externos declarativos (url, headers, etc.)
    connectors: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
    // ADR-0025: observabilidad — nivel de traza por turno en agent_turn_traces.
    // 'off' = no traza; 'metrics' = sin prompt/contexto crudos; 'full' = todo.
    trace_level: z.enum(['off', 'metrics', 'full']).optional(),
    // ADR-0025: días de retención de traces antes de limpieza (default 30).
    trace_retention_days: z.number().int().positive().optional(),
    // ADR-0025: URL de webhook n8n que recibe la traza completa de cada turno
    // para debug visual en n8n Executions. Si no está configurado, no se envía.
    debug_webhook_url: z.string().url().optional(),
    // Calendly booking feedback: link de video de nurturing post-booking (editable en /settings).
    nurturing_video_url: z.string().url().optional(),
    // Regla "camino feliz sin texto del LLM": política de texto por etapa (slug → policy).
    // Etapas sin entrada usan el default `text_policy_default`. Ver StageTextPolicySchema.
    text_policy_by_stage: z.record(z.string(), StageTextPolicySchema).optional(),
    // Política por defecto para etapas no listadas en text_policy_by_stage. Default 'text_ok'
    // para no alterar el comportamiento de tenants existentes.
    text_policy_default: StageTextPolicySchema.optional(),
  })
  .passthrough();

export type TenantConfig = z.infer<typeof TenantConfigSchema>;
