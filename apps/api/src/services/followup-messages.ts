import {
  type DbClient,
  type FollowupMessage,
  type NewFollowupMessage,
  followupMessages,
} from '@dm-api/db';
import { eq } from 'drizzle-orm';

export type { FollowupMessage };

export async function listFollowupMessages(
  db: DbClient,
  templateId: string,
): Promise<FollowupMessage[]> {
  return db
    .select()
    .from(followupMessages)
    .where(eq(followupMessages.templateId, templateId))
    .orderBy(followupMessages.sortOrder);
}

export async function getFollowupMessageById(
  db: DbClient,
  id: string,
): Promise<FollowupMessage | null> {
  const rows = await db.select().from(followupMessages).where(eq(followupMessages.id, id));
  return rows[0] ?? null;
}

export async function createFollowupMessage(
  db: DbClient,
  data: NewFollowupMessage,
): Promise<FollowupMessage> {
  const rows = await db.insert(followupMessages).values(data).returning();
  const row = rows[0];
  if (!row) throw new Error('insert returned no rows');
  return row;
}

export async function updateFollowupMessage(
  db: DbClient,
  id: string,
  patch: Partial<
    Pick<
      FollowupMessage,
      'messageType' | 'textContent' | 'mediaUrl' | 'sortOrder' | 'aiImageContext'
    >
  >,
): Promise<FollowupMessage | null> {
  const rows = await db
    .update(followupMessages)
    .set(patch)
    .where(eq(followupMessages.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function deleteFollowupMessage(db: DbClient, id: string): Promise<void> {
  await db.delete(followupMessages).where(eq(followupMessages.id, id));
}
