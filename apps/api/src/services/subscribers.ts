import { type DbClient, type Subscriber, subscribers } from '@dm-api/db';
import { and, eq, sql } from 'drizzle-orm';

export async function getOrCreateSubscriber(
  db: DbClient,
  args: {
    tenantId: string;
    manychatSubscriberId: string;
    igUserId?: string | undefined;
    igUsername?: string | undefined;
    displayName?: string | undefined;
    locale?: string | undefined;
    currentChannel?: string | undefined;
    instagramContext?: Record<string, unknown> | undefined;
  },
): Promise<Subscriber> {
  // Insert or update on conflict, returning row
  const [row] = await db
    .insert(subscribers)
    .values({
      tenantId: args.tenantId,
      manychatSubscriberId: args.manychatSubscriberId,
      igUserId: args.igUserId,
      igUsername: args.igUsername,
      displayName: args.displayName,
      locale: args.locale,
      currentChannel: args.currentChannel,
      instagramContext: args.instagramContext,
    })
    .onConflictDoUpdate({
      target: [subscribers.tenantId, subscribers.manychatSubscriberId],
      set: {
        lastSeenAt: sql`now()`,
        igUserId: sql`coalesce(excluded.ig_user_id, ${subscribers.igUserId})`,
        igUsername: sql`coalesce(excluded.ig_username, ${subscribers.igUsername})`,
        displayName: sql`coalesce(excluded.display_name, ${subscribers.displayName})`,
        locale: sql`coalesce(excluded.locale, ${subscribers.locale})`,
        currentChannel: sql`coalesce(excluded.current_channel, ${subscribers.currentChannel})`,
        // Solo sobrescribir si el webhook trajo contexto IG no vacío; un '{}'
        // entrante no debe borrar la última presencia conocida del lead.
        instagramContext: sql`case when excluded.instagram_context = '{}'::jsonb then ${subscribers.instagramContext} else excluded.instagram_context end`,
      },
    })
    .returning();

  if (!row) {
    throw new Error('subscribers upsert returned no row');
  }
  return row;
}

export async function getSubscriberById(
  db: DbClient,
  args: { tenantId: string; subscriberId: string },
): Promise<Subscriber | null> {
  const rows = await db
    .select()
    .from(subscribers)
    .where(and(eq(subscribers.id, args.subscriberId), eq(subscribers.tenantId, args.tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getSubscriberByUuid(
  db: DbClient,
  subscriberId: string,
): Promise<Subscriber | null> {
  const rows = await db.select().from(subscribers).where(eq(subscribers.id, subscriberId)).limit(1);
  return rows[0] ?? null;
}

export function isSubscriberActive(s: Subscriber, now: Date = new Date()): boolean {
  if (s.status === 'blocked') return false;
  if (s.status === 'paused') {
    if (!s.pausedUntil) return false;
    return s.pausedUntil <= now; // pause expired
  }
  return true;
}
