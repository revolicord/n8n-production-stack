import type { Redis } from 'ioredis';
import { redisKeys } from '../lib/redis-keys.js';

export interface BufferMessage {
  id: string;
  external_message_id: string | null;
  text: string | null;
  reply_type: string | null;
  ts: number;
  media_urls: string[];
}

export interface DebouncePushResult {
  token: string;
  wasFirst: boolean;
  firstTs: number;
}

/**
 * Lua atómico: RPUSH al buffer + SET token debounce + SET first_msg si nuevo.
 * Documentación: docs/onboarding/04-modelo-de-datos.md sección "Patrón Lua".
 *
 * KEYS[1] = buffer key
 * KEYS[2] = debounce key
 * KEYS[3] = firstmsg key
 * ARGV[1] = JSON del mensaje
 * ARGV[2] = nuevo token (UUID)
 * ARGV[3] = debounce TTL ms (string)
 * ARGV[4] = max_wait TTL ms (string)
 * ARGV[5] = timestamp ahora ms (string)
 *
 * Returns: { token, was_first (0|1), first_ts (string ms) }
 */
const DEBOUNCE_PUSH_LUA = `
redis.call('RPUSH', KEYS[1], ARGV[1])
redis.call('PEXPIRE', KEYS[1], 120000)

redis.call('SET', KEYS[2], ARGV[2], 'PX', tonumber(ARGV[3]))

local first_ts = redis.call('GET', KEYS[3])
local was_first = 0
if not first_ts then
  redis.call('SET', KEYS[3], ARGV[5], 'PX', tonumber(ARGV[4]))
  first_ts = ARGV[5]
  was_first = 1
end

return { ARGV[2], was_first, first_ts }
`;

/**
 * Lua atómico: drena el buffer (LRANGE 0 -1 + DEL).
 * KEYS[1] = buffer key
 */
const DRAIN_BUFFER_LUA = `
local items = redis.call('LRANGE', KEYS[1], 0, -1)
redis.call('DEL', KEYS[1])
return items
`;

export async function debouncePush(
  redis: Redis,
  args: {
    tenantId: string;
    subscriberId: string;
    message: BufferMessage;
    token: string;
    debounceMs: number;
    maxWaitMs: number;
    now: number;
  },
): Promise<DebouncePushResult> {
  const result = (await redis.eval(
    DEBOUNCE_PUSH_LUA,
    3,
    redisKeys.buffer(args.tenantId, args.subscriberId),
    redisKeys.debounce(args.tenantId, args.subscriberId),
    redisKeys.firstmsg(args.tenantId, args.subscriberId),
    JSON.stringify(args.message),
    args.token,
    String(args.maxWaitMs),
    String(args.maxWaitMs),
    String(args.now),
  )) as [string, number, string];

  return {
    token: result[0],
    wasFirst: result[1] === 1,
    firstTs: Number.parseInt(result[2], 10),
  };
}

export async function drainBuffer(
  redis: Redis,
  args: { tenantId: string; subscriberId: string },
): Promise<BufferMessage[]> {
  const items = (await redis.eval(
    DRAIN_BUFFER_LUA,
    1,
    redisKeys.buffer(args.tenantId, args.subscriberId),
  )) as string[];

  return items.map((raw) => JSON.parse(raw) as BufferMessage);
}

export async function getDebounceToken(
  redis: Redis,
  args: { tenantId: string; subscriberId: string },
): Promise<string | null> {
  return redis.get(redisKeys.debounce(args.tenantId, args.subscriberId));
}

export async function getFirstMsgTs(
  redis: Redis,
  args: { tenantId: string; subscriberId: string },
): Promise<number | null> {
  const v = await redis.get(redisKeys.firstmsg(args.tenantId, args.subscriberId));
  return v ? Number.parseInt(v, 10) : null;
}

export async function clearFirstMsg(
  redis: Redis,
  args: { tenantId: string; subscriberId: string },
): Promise<void> {
  await redis.del(redisKeys.firstmsg(args.tenantId, args.subscriberId));
}

export async function getBufferLength(
  redis: Redis,
  args: { tenantId: string; subscriberId: string },
): Promise<number> {
  return redis.llen(redisKeys.buffer(args.tenantId, args.subscriberId));
}

export async function clearBuffer(
  redis: Redis,
  args: { tenantId: string; subscriberId: string },
): Promise<void> {
  await redis.del(
    redisKeys.buffer(args.tenantId, args.subscriberId),
    redisKeys.debounce(args.tenantId, args.subscriberId),
    redisKeys.firstmsg(args.tenantId, args.subscriberId),
  );
}

export const debounceLuaForTests = { DEBOUNCE_PUSH_LUA, DRAIN_BUFFER_LUA };
