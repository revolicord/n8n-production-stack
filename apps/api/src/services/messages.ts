import { type DbClient, type MessageRaw, messagesRaw } from '@dm-api/db';

export async function insertMessageRaw(
  db: DbClient,
  args: {
    tenantId: string;
    subscriberId: string;
    channel?: string;
    externalMessageId: string;
    idempotencyHash: string;
    direction: 'in' | 'out';
    payload: unknown;
    text: string | null;
    mediaUrls: string[];
    triggerSource?: string | undefined;
    triggerChannel?: string | undefined;
    triggerRef?: string | undefined;
  },
): Promise<MessageRaw> {
  const [row] = await db
    .insert(messagesRaw)
    .values({
      tenantId: args.tenantId,
      subscriberId: args.subscriberId,
      channel: args.channel ?? 'instagram',
      externalMessageId: args.externalMessageId,
      idempotencyHash: args.idempotencyHash,
      direction: args.direction,
      payload: args.payload,
      text: args.text,
      hasMedia: args.mediaUrls.length > 0,
      mediaUrls: args.mediaUrls,
      triggerSource: args.triggerSource,
      triggerChannel: args.triggerChannel,
      triggerRef: args.triggerRef,
    })
    .returning();

  if (!row) {
    throw new Error('messages_raw insert returned no row');
  }
  return row;
}
