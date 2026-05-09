import type { Redis } from 'ioredis';
import { redisKeys } from '../lib/redis-keys.js';

/**
 * Marca un hash de webhook como procesado. Devuelve true si era nuevo,
 * false si ya estaba registrado (duplicado de ManyChat).
 *
 * Documentación: docs-dm-settings/04-debounce-y-turnos.md sección "Idempotencia".
 */
export async function tryClaimIdempotency(
  redis: Redis,
  hash: string,
  ttlMs: number,
): Promise<boolean> {
  const result = await redis.set(redisKeys.idemp(hash), '1', 'PX', ttlMs, 'NX');
  return result === 'OK';
}
