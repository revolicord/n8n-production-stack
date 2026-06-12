import type { DbClient } from '@dm-api/db';
import { createDb } from '@dm-api/db';
import { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { pino } from 'pino';
import { getAgentConfig } from './config.js';

export interface Deps {
  db: DbClient;
  redis: Redis;
  logger: Logger;
  clock: () => number;
  rng: () => number;
}

let singletonDeps: Deps | null = null;

export function getDeps(): Deps {
  if (!singletonDeps) {
    const config = getAgentConfig();
    singletonDeps = {
      db: createDb(config.DATABASE_URL),
      redis: new Redis(config.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false }),
      logger: pino({ level: process.env.LOG_LEVEL ?? 'info' }),
      clock: () => Date.now(),
      rng: () => Math.random(),
    };
  }
  return singletonDeps;
}

export function makeDeps(overrides: Partial<Deps>): Deps {
  const base = getDeps();
  return { ...base, ...overrides };
}
