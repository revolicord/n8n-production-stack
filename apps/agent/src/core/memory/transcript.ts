import type { DbClient, Turn } from '@dm-api/db';
import { messagesRaw } from '@dm-api/db';
import { mediaPlaceholder } from '@dm-api/shared';
import type { ContentClass } from '@dm-api/shared';
import { and, desc, eq, gte } from 'drizzle-orm';
import type { TranscriptMessage } from '../context/assemble.js';

export async function buildTranscript(
  db: DbClient,
  args: {
    tenantId: string;
    subscriberId: string;
    maxTurns: number;
    recentTurns: Pick<Turn, 'responseText' | 'startedAt' | 'completedAt'>[];
  },
): Promise<TranscriptMessage[]> {
  // Determine cutoff: go back far enough to cover maxTurns
  const cutoffTurn = args.recentTurns[args.recentTurns.length - 1];
  const cutoff = cutoffTurn?.startedAt ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const rows = await db
    .select()
    .from(messagesRaw)
    .where(
      and(
        eq(messagesRaw.tenantId, args.tenantId),
        eq(messagesRaw.subscriberId, args.subscriberId),
        gte(messagesRaw.receivedAt, cutoff),
      ),
    )
    .orderBy(desc(messagesRaw.receivedAt))
    .limit(args.maxTurns * 5);

  const sorted = rows.reverse();
  const messages: TranscriptMessage[] = [];

  for (const row of sorted) {
    if (row.direction === 'in') {
      const text =
        row.text ??
        mediaPlaceholder(
          ((row.payload as { content_class?: string }).content_class as ContentClass) ?? 'unknown',
        );
      messages.push({ role: 'user', content: text });
    } else if (row.direction === 'out') {
      const text = row.text ?? '[contenido enviado]';
      messages.push({ role: 'assistant', content: text });
    }
  }

  return messages;
}
