import { type DbClient, type Turn, turns } from '@dm-api/db';
import { eq, sql } from 'drizzle-orm';

export async function createTurn(
  db: DbClient,
  args: {
    id?: string;
    tenantId: string;
    conversationId: string;
    subscriberId: string;
    batchSize: number;
    batchText: string;
    batchMessageIds: string[];
    triggerSource?: string | undefined;
    triggerChannel?: string | undefined;
  },
): Promise<Turn> {
  const [row] = await db
    .insert(turns)
    .values({
      ...(args.id ? { id: args.id } : {}),
      tenantId: args.tenantId,
      conversationId: args.conversationId,
      subscriberId: args.subscriberId,
      batchSize: args.batchSize,
      batchText: args.batchText,
      batchMessageIds: args.batchMessageIds,
      status: 'pending',
      triggerSource: args.triggerSource,
      triggerChannel: args.triggerChannel,
    })
    .returning();

  if (!row) {
    throw new Error('turns insert returned no row');
  }
  return row;
}

export async function markTurnDispatched(
  db: DbClient,
  args: { turnId: string; n8nExecutionId: string | null },
): Promise<void> {
  await db
    .update(turns)
    .set({
      status: 'dispatched',
      dispatchedAt: sql`now()`,
      n8nExecutionId: args.n8nExecutionId,
    })
    .where(eq(turns.id, args.turnId));
}

export async function markTurnFailed(
  db: DbClient,
  args: { turnId: string; error: string },
): Promise<void> {
  await db
    .update(turns)
    .set({ status: 'failed', error: args.error, completedAt: sql`now()` })
    .where(eq(turns.id, args.turnId));
}

export async function completeTurn(
  db: DbClient,
  args: {
    turnId: string;
    status: 'completed' | 'failed' | 'cancelled';
    responseText: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
    llmModel: string | null;
    promptVersion: string | null;
    n8nExecutionId: string | null;
    error: string | null;
  },
): Promise<Turn | null> {
  const [row] = await db
    .update(turns)
    .set({
      status: args.status,
      responseText: args.responseText,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      costUsd: args.costUsd != null ? args.costUsd.toString() : null,
      llmModel: args.llmModel,
      promptVersion: args.promptVersion,
      n8nExecutionId: args.n8nExecutionId,
      error: args.error,
      completedAt: sql`now()`,
      durationMs: sql`extract(epoch from (now() - started_at)) * 1000`,
    })
    .where(eq(turns.id, args.turnId))
    .returning();

  return row ?? null;
}

export async function getTurnById(db: DbClient, turnId: string): Promise<Turn | null> {
  const rows = await db.select().from(turns).where(eq(turns.id, turnId)).limit(1);
  return rows[0] ?? null;
}
