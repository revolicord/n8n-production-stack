/**
 * Tests del throttle de escalado: claim atómico y release total al reanudar.
 *
 * El bug que cubren: tras reanudar a un lead, el throttle del primer aviso
 * seguía vivo hasta 10 min, así que un segundo medio del MISMO tipo (p.ej. dos
 * voice notes seguidos, ambos kind='unknown') no volvía a notificar ni a
 * re-pausar. `releaseNotificationThrottles` lo limpia para todos los kinds.
 */
import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { redisKeys } from '../lib/redis-keys.js';
import { releaseNotificationThrottles, tryClaimNotificationThrottle } from './notifications.js';

const TENANT = '11111111-1111-1111-1111-111111111111';
const SUB = '22222222-2222-2222-2222-222222222222';

describe('tryClaimNotificationThrottle', () => {
  it('gana la ventana cuando SET NX devuelve OK', async () => {
    const redis = { set: vi.fn().mockResolvedValue('OK') } as unknown as Redis;
    const won = await tryClaimNotificationThrottle(redis, {
      tenantId: TENANT,
      subscriberId: SUB,
      kind: 'audio',
    });
    expect(won).toBe(true);
    expect(redis.set).toHaveBeenCalledWith(
      redisKeys.notif(TENANT, SUB, 'audio'),
      '1',
      'EX',
      600,
      'NX',
    );
  });

  it('pierde la ventana cuando ya hay un aviso reciente (SET NX null)', async () => {
    const redis = { set: vi.fn().mockResolvedValue(null) } as unknown as Redis;
    const won = await tryClaimNotificationThrottle(redis, {
      tenantId: TENANT,
      subscriberId: SUB,
      kind: 'unknown',
    });
    expect(won).toBe(false);
  });
});

describe('releaseNotificationThrottles', () => {
  it('borra los throttles de TODOS los kinds del lead', async () => {
    const del = vi.fn().mockResolvedValue(1);
    const redis = { del } as unknown as Redis;

    await releaseNotificationThrottles(redis, { tenantId: TENANT, subscriberId: SUB });

    expect(del).toHaveBeenCalledTimes(1);
    const keys = del.mock.calls[0] as string[];
    // Cubre el universo cerrado de kinds (medios + keyword + agent).
    for (const kind of [
      'audio',
      'image',
      'video',
      'location',
      'file',
      'unknown',
      'keyword',
      'agent',
    ]) {
      expect(keys).toContain(redisKeys.notif(TENANT, SUB, kind));
    }
  });

  it('tras release, el mismo kind vuelve a poder reclamar la ventana', async () => {
    // Simula Redis real: claim ocupa la clave; del la libera; re-claim gana.
    const store = new Set<string>();
    const redis = {
      set: vi.fn(async (key: string, _v, _ex, _ttl, _nx) => {
        if (store.has(key)) return null;
        store.add(key);
        return 'OK';
      }),
      del: vi.fn(async (...keys: string[]) => {
        for (const k of keys) store.delete(k);
        return keys.length;
      }),
    } as unknown as Redis;

    const args = { tenantId: TENANT, subscriberId: SUB, kind: 'unknown' as const };
    expect(await tryClaimNotificationThrottle(redis, args)).toBe(true);
    expect(await tryClaimNotificationThrottle(redis, args)).toBe(false); // throttled
    await releaseNotificationThrottles(redis, { tenantId: TENANT, subscriberId: SUB });
    expect(await tryClaimNotificationThrottle(redis, args)).toBe(true); // re-pausa posible
  });
});
