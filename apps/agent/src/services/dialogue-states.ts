import type { DbClient } from '@dm-api/db';
import { dialogueStates } from '@dm-api/db';
import type { DialogueState } from '@dm-api/shared';
import { DialogueStateSchema } from '@dm-api/shared';
import { and, eq, sql } from 'drizzle-orm';

const EMPTY_STATE: DialogueState = {
  version: 1,
  stack: [],
  slots: {},
  repair_context: null,
  last_turn_id: null,
};

export async function loadDialogueState(
  db: DbClient,
  args: { conversationId: string },
): Promise<DialogueState> {
  const rows = await db
    .select()
    .from(dialogueStates)
    .where(eq(dialogueStates.conversationId, args.conversationId))
    .limit(1);

  const row = rows[0];
  if (!row) return { ...EMPTY_STATE };

  const raw = {
    version: 1,
    stack: row.stack,
    slots: row.slots,
    repair_context: row.repairContext ?? null,
    last_turn_id: row.lastTurnId ?? null,
  };

  const parsed = DialogueStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : { ...EMPTY_STATE };
}

export async function saveDialogueState(
  db: DbClient,
  args: {
    conversationId: string;
    tenantId: string;
    state: DialogueState;
    turnId: string;
  },
): Promise<void> {
  await db
    .insert(dialogueStates)
    .values({
      conversationId: args.conversationId,
      tenantId: args.tenantId,
      stack: args.state.stack,
      slots: args.state.slots,
      repairContext: args.state.repair_context ?? undefined,
      lastTurnId: args.turnId,
      updatedAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: dialogueStates.conversationId,
      set: {
        stack: args.state.stack,
        slots: args.state.slots,
        repairContext: args.state.repair_context ?? undefined,
        lastTurnId: args.turnId,
        updatedAt: sql`now()`,
      },
    });
}

export async function clearDialogueState(
  db: DbClient,
  args: { conversationId: string; tenantId: string },
): Promise<void> {
  await db
    .update(dialogueStates)
    .set({
      stack: [],
      slots: {},
      repairContext: undefined,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(dialogueStates.conversationId, args.conversationId),
        eq(dialogueStates.tenantId, args.tenantId),
      ),
    );
}
