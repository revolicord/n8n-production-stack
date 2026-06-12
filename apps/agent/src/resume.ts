import { setRepairContext } from './core/flow-engine/repair.js';
import { getDeps } from './deps.js';
import { loadDialogueState, saveDialogueState } from './services/dialogue-states.js';

/**
 * Resume a conversation that was interrupted by HumanHandoff.
 * Sets repair_context to continue_interrupted with the human note,
 * so the next turn the agent knows to pick up where it left off.
 */
export async function resumeConversation(
  conversationId: string,
  opts: {
    tenantId: string;
    subscriberId: string;
    note: string;
    resolvedBy: string;
    notificationId: string;
  },
): Promise<{ success: boolean; conversationId: string }> {
  const deps = getDeps();
  const { db } = deps;

  const dialogueState = await loadDialogueState(db, { conversationId });

  if (dialogueState.repair_context?.pattern !== 'human_handoff') {
    deps.logger.warn(
      { conversationId },
      'resumeConversation called on non-interrupted conversation',
    );
    return { success: false, conversationId };
  }

  const updatedState = setRepairContext(
    dialogueState,
    'continue_interrupted',
    { note: opts.note, resolved_by: opts.resolvedBy, notification_id: opts.notificationId },
    new Date().toISOString(),
  );

  await saveDialogueState(db, {
    conversationId,
    tenantId: opts.tenantId,
    state: updatedState,
    turnId: dialogueState.last_turn_id ?? '',
  });

  deps.logger.info(
    { conversationId, resolved_by: opts.resolvedBy },
    'conversation resumed after handoff',
  );

  return { success: true, conversationId };
}
