import { type Conversation, type DbClient, conversations } from '@dm-api/db';
import { and, desc, eq, sql } from 'drizzle-orm';

export async function getOrCreateOpenConversation(
  db: DbClient,
  args: { tenantId: string; subscriberId: string },
): Promise<Conversation> {
  const existing = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.tenantId, args.tenantId),
        eq(conversations.subscriberId, args.subscriberId),
        eq(conversations.status, 'open'),
      ),
    )
    .orderBy(desc(conversations.openedAt))
    .limit(1);

  if (existing[0]) {
    return existing[0];
  }

  const [created] = await db
    .insert(conversations)
    .values({ tenantId: args.tenantId, subscriberId: args.subscriberId })
    .returning();

  if (!created) {
    throw new Error('conversations insert returned no row');
  }
  return created;
}

export async function touchUserMsg(db: DbClient, conversationId: string): Promise<void> {
  await db
    .update(conversations)
    .set({ lastUserMsgAt: sql`now()` })
    .where(eq(conversations.id, conversationId));
}

export async function touchBotMsg(db: DbClient, conversationId: string): Promise<void> {
  await db
    .update(conversations)
    .set({ lastBotMsgAt: sql`now()` })
    .where(eq(conversations.id, conversationId));
}

export async function closeConversation(db: DbClient, conversationId: string): Promise<void> {
  await db
    .update(conversations)
    .set({ status: 'closed', closedAt: sql`now()` })
    .where(eq(conversations.id, conversationId));
}
