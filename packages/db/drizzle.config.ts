import type { Config } from 'drizzle-kit';

export default {
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://n8n:CHANGE_ME@localhost:5432/n8n?schema=api',
  },
  schemaFilter: ['api'],
  verbose: true,
  strict: true,
} satisfies Config;
