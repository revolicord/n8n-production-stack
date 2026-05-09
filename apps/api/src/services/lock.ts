import type { Redis } from 'ioredis';
import { redisKeys } from '../lib/redis-keys.js';

/**
 * Adquiere lock atómico de turno. Devuelve true si fue adquirido,
 * false si ya había uno activo.
 */
export async function tryAcquireTurnLock(
  redis: Redis,
  args: { tenantId: string; subscriberId: string; turnId: string; ttlMs: number },
): Promise<boolean> {
  const result = await redis.set(
    redisKeys.lock(args.tenantId, args.subscriberId),
    args.turnId,
    'PX',
    args.ttlMs,
    'NX',
  );
  return result === 'OK';
}

/**
 * Libera el lock de turno solo si pertenece a este turn_id (evita
 * que un turno antiguo libere uno nuevo). Lua atómico.
 */
const RELEASE_LOCK_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end
`;

export async function releaseTurnLock(
  redis: Redis,
  args: { tenantId: string; subscriberId: string; turnId: string },
): Promise<boolean> {
  const result = (await redis.eval(
    RELEASE_LOCK_LUA,
    1,
    redisKeys.lock(args.tenantId, args.subscriberId),
    args.turnId,
  )) as number;
  return result === 1;
}

/**
 * Libera lock incondicionalmente (uso admin/emergencia).
 */
export async function forceReleaseTurnLock(
  redis: Redis,
  args: { tenantId: string; subscriberId: string },
): Promise<void> {
  await redis.del(redisKeys.lock(args.tenantId, args.subscriberId));
}
