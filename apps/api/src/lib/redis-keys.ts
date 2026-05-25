/**
 * Convenciones de claves Redis. Documentadas en
 * docs/onboarding/04-modelo-de-datos.md.
 */
export const redisKeys = {
  idemp: (hash: string): string => `idemp:${hash}`,
  buffer: (tenantId: string, subscriberId: string): string => `buffer:${tenantId}:${subscriberId}`,
  debounce: (tenantId: string, subscriberId: string): string =>
    `debounce:${tenantId}:${subscriberId}`,
  firstmsg: (tenantId: string, subscriberId: string): string =>
    `firstmsg:${tenantId}:${subscriberId}`,
  lock: (tenantId: string, subscriberId: string): string => `lock:turn:${tenantId}:${subscriberId}`,
  rate: (tenantId: string, subscriberId: string): string => `rate:${tenantId}:${subscriberId}`,
} as const;
