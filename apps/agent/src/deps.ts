import type { DbClient } from '@dm-api/db';
import { createDb } from '@dm-api/db';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
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
  /**
   * LangGraph checkpointer (durabilidad de ejecución + interrupt/resume).
   * NO es la fuente de verdad del estado de diálogo — eso sigue siendo
   * `dialogue_states` (ADR-0025). Vive en el schema `api`.
   */
  checkpointer: PostgresSaver;
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
      checkpointer: PostgresSaver.fromConnString(config.DATABASE_URL, { schema: 'api' }),
    };
  }
  return singletonDeps;
}

let setupPromise: Promise<void> | null = null;

/**
 * Crea las tablas del checkpointer (idempotente). Hay que esperarlo una vez
 * antes del primer `graph.invoke`. Memoizado.
 */
export function ensureCheckpointerSetup(): Promise<void> {
  if (!setupPromise) setupPromise = getDeps().checkpointer.setup();
  return setupPromise;
}

export function makeDeps(overrides: Partial<Deps>): Deps {
  const base = getDeps();
  return { ...base, ...overrides };
}
