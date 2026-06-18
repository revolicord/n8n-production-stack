import { z } from 'zod';

const AgentConfigSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-6'),
  AGENT_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  AGENT_MAX_TRANSCRIPT_TURNS: z.coerce.number().int().positive().default(20),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  // Observabilidad LangSmith (ADR-0025) — la lee la librería desde process.env;
  // las declaramos para validarlas/documentarlas. Provisional, opcional.
  // langsmith >=0.2 usa LANGSMITH_* (no LANGCHAIN_*).
  LANGSMITH_TRACING: z.string().optional(),
  LANGSMITH_API_KEY: z.string().optional(),
  LANGSMITH_PROJECT: z.string().optional(),
  LANGSMITH_ENDPOINT: z.string().optional(),
  // Alertas operativas via Telegram
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_DEFAULT_CHAT_ID: z.string().optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

let cached: AgentConfig | null = null;

export function getAgentConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  if (!cached) {
    const result = AgentConfigSchema.safeParse(env);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
        .join('\n');
      throw new Error(`Invalid agent config:\n${issues}`);
    }
    cached = result.data;
  }
  return cached;
}
