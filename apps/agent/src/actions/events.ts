import type { DbClient } from '@dm-api/db';
import { domainEvents } from '@dm-api/db';

export async function emitDomainEvent(
  db: DbClient,
  args: {
    tenantId: string;
    type: string;
    payload: Record<string, unknown>;
    turnId?: string | undefined;
  },
): Promise<void> {
  await db.insert(domainEvents).values({
    tenantId: args.tenantId,
    type: args.type,
    payload: args.payload,
    turnId: args.turnId,
  });
}
