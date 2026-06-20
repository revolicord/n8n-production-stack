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

/**
 * Ventana horaria permitida para enviar follow-ups (quiet hours). El runner
 * pospone los envíos que vencen fuera de [start_hour, end_hour) en la zona
 * horaria del tenant, en vez de molestar al lead de madrugada. Si `end_hour`
 * es menor o igual a `start_hour` la ventana se interpreta como vacía (sin envío).
 * No aplica a los recordatorios de cita (anclados a una hora elegida por el lead).
 */
export const FollowupWindowSchema = z.object({
  timezone: z.string().min(1),
  start_hour: z.number().int().min(0).max(23),
  end_hour: z.number().int().min(1).max(24),
});
export type FollowupWindow = z.infer<typeof FollowupWindowSchema>;

/**
 * Señales positivas que disparan el fast-path determinista (cero tokens): cuando
 * el lead las envía en una etapa `flow_only`, el motor avanza por la transición
 * `trigger:'affirm'` SIN llamar al LLM. Editable por tenant para que el equipo del
 * dashboard agregue variaciones que surjan ("oki", "ya quedó", "perfe", …).
 *
 * - `phrases`: frases extra que cuentan como señal positiva. Se normalizan igual
 *   que el input (sin acentos/signos, lowercase, match EXACTO de la frase completa).
 * - `emojis`: emojis de aprobación extra (los tonos de piel se normalizan solos).
 * - `mode`: 'extend' (default) SUMA a los defaults del sistema; 'replace' usa SOLO
 *   las `phrases` del tenant. Los emojis de aprobación base (👍👌✅…) SIEMPRE se
 *   conservan — el pulgar arriba nunca deja de ser cero-tokens.
 */
export const AffirmSignalsSchema = z.object({
  phrases: z.array(z.string()).optional(),
  emojis: z.array(z.string()).optional(),
  mode: z.enum(['extend', 'replace']).optional(),
});
export type AffirmSignals = z.infer<typeof AffirmSignalsSchema>;

/**
 * Circuit breaker / detector de atasco para la "cola caótica": leads que consumen
 * muchos turnos LLM en la misma etapa sin avanzar (el lead que no entiende, el que da
 * vueltas 20 turnos sin resultado y le cuesta dinero al dueño del setter). Cuando el
 * lead lleva `max_turns_in_stage` turnos completados en la etapa actual SIN avanzar,
 * el motor corta de forma DETERMINISTA (cero tokens) — escala a humano o descalifica —
 * en vez de seguir pagando llamadas al LLM indefinidamente.
 *
 * Es un gate determinista análogo al fast-path: solo se evalúa cuando el turno IBA a
 * caer al LLM (el fast-path ya no aplicó). Un 👍 que avanza por fast-path resetea la
 * cuenta (nueva etapa) — el breaker solo dispara en atascos reales.
 *
 * - `enabled`: interruptor (default true — es una salvaguarda de costo).
 * - `max_turns_in_stage`: turnos completados en la MISMA etapa antes de cortar (default 10).
 *   Un lead sano avanza cada 1–3 turnos; 10 en una sola etapa es patológico.
 * - `action`: 'handoff' (default, escala a humano, no pierde el lead) | 'disqualify'
 *   (avanza por la transición `trigger:'deny'`; si no hay, cae a 'handoff').
 * - `exempt_stages`: etapas donde NUNCA dispara. Las etapas terminales (is_terminal) se
 *   eximen automáticamente — un lead aparcado en 'booked'/'disqualified' no se escala.
 */
export const StuckDetectorSchema = z.object({
  enabled: z.boolean().optional(),
  max_turns_in_stage: z.number().int().positive().optional(),
  action: z.enum(['handoff', 'disqualify']).optional(),
  exempt_stages: z.array(z.string()).optional(),
});
export type StuckDetector = z.infer<typeof StuckDetectorSchema>;

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
    // Follow-ups automáticos: interruptor global por tenant (default true si no se define).
    followups_enabled: z.boolean().optional(),
    // Si el lead responde, cancelar sus follow-ups activos (default true). El agente los
    // re-programa vía schedule_followup si la conversación vuelve a enfriarse.
    followup_reset_on_reply: z.boolean().optional(),
    // Quiet hours: ventana permitida de envío de follow-ups. Sin definir o null = 24/7.
    followup_window: FollowupWindowSchema.nullable().optional(),
    // Fast-path determinista: señales positivas editables por tenant (👍, "ya lo vi",
    // variaciones). Ver AffirmSignalsSchema. Si no se define, se usan los defaults.
    affirm_signals: AffirmSignalsSchema.optional(),
    // Presupuesto de tokens del transcript (historial). Tras compresión lossless de
    // turnos triviales (👍 repetidos, placeholders de media) se conservan los mensajes
    // MÁS RECIENTES que entren en este presupuesto; los más viejos se descartan (el
    // estado estructurado — etapa + slots — ya resume lo consumido). NO se hace resumen
    // por LLM: resumir contenido barato cuesta más de lo que ahorra. Default 1200.
    transcript_max_tokens: z.number().int().positive().optional(),
    // Circuit breaker / detector de atasco para la cola caótica. Ver StuckDetectorSchema.
    stuck_detector: StuckDetectorSchema.optional(),
  })
  .passthrough();

export type TenantConfig = z.infer<typeof TenantConfigSchema>;
