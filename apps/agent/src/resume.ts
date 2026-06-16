import { Command } from '@langchain/langgraph';
import { setRepairContext } from './core/flow-engine/repair.js';
import { ensureCheckpointerSetup, getDeps } from './deps.js';
import { getCompiledGraph } from './graph/build-graph.js';
import { loadDialogueState, saveDialogueState } from './services/dialogue-states.js';

/**
 * Reanuda una conversación que quedó suspendida por HumanHandoff (ADR-0025 Fase B).
 *
 * Camino normal: el thread LangGraph (thread_id = conversationId) está suspendido
 * en `interrupt()`; se reanuda con `Command({ resume })`, el nodo handoff continúa
 * y transiciona `repair_context` a `continue_interrupted`.
 *
 * Fallback: si el thread no está suspendido (p.ej. se reinició el proceso o el
 * handoff fue por el camino clásico), se transiciona el `repair_context`
 * directamente sobre `dialogue_states` para que el próximo turno retome.
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
  await ensureCheckpointerSetup();
  const graph = getCompiledGraph(deps);
  const threadConfig = { configurable: { thread_id: conversationId } };

  const snapshot = await graph.getState(threadConfig);
  const suspended = snapshot.next.length > 0;

  if (suspended) {
    await graph.invoke(
      new Command({ resume: { note: opts.note, resolved_by: opts.resolvedBy } }),
      threadConfig,
    );
    deps.logger.info(
      { conversationId, resolved_by: opts.resolvedBy },
      'conversation resumed via Command',
    );
    return { success: true, conversationId };
  }

  // Fallback: no hay interrupt pendiente — transición directa del flag.
  const dialogueState = await loadDialogueState(deps.db, { conversationId });
  if (dialogueState.repair_context?.pattern !== 'human_handoff') {
    deps.logger.warn(
      { conversationId },
      'resumeConversation: no suspended thread and not in human_handoff',
    );
    return { success: false, conversationId };
  }
  const updatedState = setRepairContext(
    dialogueState,
    'continue_interrupted',
    { note: opts.note, resolved_by: opts.resolvedBy, notification_id: opts.notificationId },
    new Date().toISOString(),
  );
  await saveDialogueState(deps.db, {
    conversationId,
    tenantId: opts.tenantId,
    state: updatedState,
    turnId: dialogueState.last_turn_id ?? '',
  });
  deps.logger.info(
    { conversationId, resolved_by: opts.resolvedBy },
    'conversation resumed via flag fallback',
  );
  return { success: true, conversationId };
}
