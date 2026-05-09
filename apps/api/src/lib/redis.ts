import { Redis, type RedisOptions } from 'ioredis';
import { getConfig } from '../config.js';

const baseOpts: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
};

let primary: Redis | null = null;

export function getRedis(): Redis {
  if (!primary) {
    primary = new Redis(getConfig().REDIS_URL, baseOpts);
  }
  return primary;
}

/**
 * BullMQ requires a separate connection for blocking operations
 * (workers). Use this to create dedicated clients.
 */
export function createRedisConnection(): Redis {
  return new Redis(getConfig().REDIS_URL, baseOpts);
}

export async function closeRedis(): Promise<void> {
  if (primary) {
    await primary.quit().catch(() => {
      /* ignore */
    });
    primary = null;
  }
}
