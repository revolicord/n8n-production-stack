import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  MC_WEBHOOK_TOKEN: z.string().min(16),
  N8N_CALLBACK_TOKEN: z.string().min(16),
  ADMIN_JWT_SECRET: z.string().min(32),

  N8N_BASE_URL: z.string().url(),
  PUBLIC_API_URL: z.string().url(),

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(10),

  DEBOUNCE_MS: z.coerce.number().int().positive().default(15000),
  MAX_WAIT_MS: z.coerce.number().int().positive().default(30000),
  LOCK_TTL_MS: z.coerce.number().int().positive().default(90000),
  RATE_PER_MINUTE: z.coerce.number().int().positive().default(20),
  BUFFER_HARD_LIMIT: z.coerce.number().int().positive().default(20),

  MINIO_ENDPOINT: z.string().url(),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_BUCKET_ASSETS: z.string().default('assets'),
  MINIO_PUBLIC_URL: z.string().url(),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

let cachedConfig: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment config:\n${issues}`);
  }
  return result.data;
}

export function getConfig(): AppConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}
