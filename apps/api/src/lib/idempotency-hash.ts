import { createHash } from 'node:crypto';

/**
 * Hash determinista por (tenant, subscriber, external_message_id).
 * Si ManyChat reenvía el mismo mensaje, mismo hash → dedup.
 */
export function buildIdempotencyHash(args: {
  tenantId: string;
  subscriberId: string;
  externalMessageId: string;
}): string {
  return createHash('sha256')
    .update(`${args.tenantId}:${args.subscriberId}:${args.externalMessageId}`)
    .digest('hex');
}
