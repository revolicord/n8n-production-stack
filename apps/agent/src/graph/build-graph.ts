import { turns } from '@dm-api/db';
import type { AgentResponse, TurnInput } from '@dm-api/shared';
import { END, START, StateGraph, interrupt } from '@langchain/langgraph';
import { eq, sql } from 'drizzle-orm';
import { notifyHumanHandler } from '../actions/handlers/notify-human.js';
import { setRepairContext } from '../core/flow-engine/repair.js';
import type { Deps } from '../deps.js';
import { loadDialogueState, saveDialogueState } from '../services/dialogue-states.js';
import { pauseSubscriberForHandoff } from '../services/handoff.js';
import { type TraceLevel, resolveTraceMode, saveTurnTrace } from '../services/traces.js';
import { AgentState, type AgentStateT, type DecisionPath, initialState } from './annotation.js';
import { assembleContextNode } from './nodes/assemble-context.js';
import { executeActionsNode } from './nodes/execute-actions.js';
import { tryFastPath } from './nodes/fast-path.js';
import { flowEngineNode } from './nodes/flow-engine.js';
import { respondNode } from './nodes/respond.js';
import { buildLlmRequest, understandNode } from './nodes/understand.js';

/** Payload que el nodo handoff entrega al humano vía `interrupt()`. */
export interface HandoffInterruptPayload {
  kind: string;
  reason: string;
  summary?: string | undefined;
  notification_id?: string | undefined;
}

/** Valor con el que el humano reanuda la conversación vía `Command({ resume })`. */
export interface HandoffResumeValue {
  note?: string;
  resolved_by?: string;
}

/**
 * Construye el grafo del agente (ADR-0025). LangGraph orquesta; el cerebro CALM
 * (`advanceDialogue`/`engine.ts`) se invoca dentro del nodo `flow_engine` sin
 * cambios. `dialogue_states` sigue siendo la fuente de verdad legible; el
 * checkpointer solo da durabilidad e interrupt/resume.
 */
export function compileAgentGraph(deps: Deps) {
  const builder = new StateGraph(AgentState)
    .addNode('assemble_context', async (state: AgentStateT) => {
      const ctx = await assembleContextNode(state.input, deps);
      return { assembled: ctx, dialogueStateBefore: structuredClone(ctx.dialogueState) };
    })
    // Builds systemPrompt + message history and checkpoints them BEFORE the API
    // call — so the snapshot is visible in debug traces even when callLlm fails.
    .addNode('prepare_prompt', (state: AgentStateT) => {
      const ctx = state.assembled;
      if (!ctx) throw new Error('prepare_prompt: assembled context missing');
      // Camino feliz determinista: si aplica, NO se llama al LLM (cero tokens).
      // La decisión (y, si cae al LLM, POR QUÉ) se loguea y se persiste en la
      // traza (decision_path + fast_path_skip_reason) para diagnóstico sin código.
      const decision = tryFastPath(state.input, ctx);
      deps.logger.child({ turn_id: state.input.turn_id, node: 'prepare_prompt' }).info(
        {
          decision: decision.kind,
          skip_reason: decision.kind === 'llm' ? decision.skipReason : null,
          stage: ctx.currentStage,
        },
        'fast-path decision',
      );
      if (decision.kind === 'fast_path') {
        return { fastPath: decision.result, fastPathSkipReason: null, llmRequest: null };
      }
      return {
        fastPath: null,
        fastPathSkipReason: decision.skipReason,
        llmRequest: buildLlmRequest(state.input, ctx),
      };
    })
    .addNode('understand', async (state: AgentStateT) => {
      const ctx = state.assembled;
      if (!ctx) throw new Error('understand: assembled context missing');
      // Fast-path: el plan ya está decidido sin LLM.
      if (state.fastPath) {
        deps.logger
          .child({ turn_id: state.input.turn_id, node: 'understand' })
          .info(
            { fast_path: true, reason: state.fastPath.reason },
            'understand skipped (fast-path)',
          );
        return {
          allCommands: [...state.input.system_commands, ...state.fastPath.commands],
          llmReasoning: state.fastPath.reason,
          llmMetrics: null,
          decisionPath: 'fast_path' as const,
        };
      }
      const r = await understandNode(state.input, ctx, deps, state.llmRequest);
      // metrics === null + sin llmRequest ⟹ turno solo de system_commands (sin LLM).
      const decisionPath: DecisionPath = r.metrics ? 'llm' : 'system';
      return {
        allCommands: r.commands,
        llmReasoning: r.reasoning,
        llmMetrics: r.metrics,
        decisionPath,
      };
    })
    .addNode('flow_engine', (state: AgentStateT) => {
      const ctx = state.assembled;
      if (!ctx) throw new Error('flow_engine: assembled context missing');
      return { flowResult: flowEngineNode(ctx, state.allCommands) };
    })
    .addNode('handoff', async (state: AgentStateT) => handoffNode(state, deps))
    .addNode('execute_actions', async (state: AgentStateT) => {
      const ctx = state.assembled;
      const fr = state.flowResult;
      if (!ctx || !fr) throw new Error('execute_actions: state missing');
      const r = await executeActionsNode(state.input, fr, ctx, deps);
      return { actionResults: r.results, responseTexts: r.responseTexts, finalStage: r.finalStage };
    })
    .addNode('respond', async (state: AgentStateT) => respondNode(state, deps))
    .addEdge(START, 'assemble_context')
    .addEdge('assemble_context', 'prepare_prompt')
    .addEdge('prepare_prompt', 'understand')
    .addEdge('understand', 'flow_engine')
    .addConditionalEdges(
      'flow_engine',
      (state: AgentStateT) => (state.flowResult?.interrupt ? 'handoff' : 'execute_actions'),
      ['handoff', 'execute_actions'],
    )
    .addEdge('handoff', 'respond')
    .addEdge('execute_actions', 'respond')
    .addEdge('respond', END);

  return builder.compile({ checkpointer: deps.checkpointer });
}

/**
 * Nodo de handoff a humano con `interrupt()` nativo de LangGraph (ADR-0025 Fase B).
 *
 * Flujo en dos pasadas (LangGraph re-ejecuta el nodo desde el inicio al reanudar):
 *  - SUSPENDER: pausa al lead, crea la notificación, persiste el turno como
 *    `interrupted` + `repair_context='human_handoff'`, y llama `interrupt()` que
 *    suspende el thread y devuelve `__interrupt__` al worker.
 *  - REANUDAR (Command): el guard por `repair_context` (releído fresco de
 *    `dialogue_states`) salta TODO el bloque de suspensión — evita duplicar la
 *    notificación/pausa al re-ejecutarse. `interrupt()` devuelve el valor del
 *    humano; se transiciona a `continue_interrupted` y el grafo sigue a `respond`.
 *
 * dry_run/shadow NO suspende (no hay humano que reanude un shadow) y corre en un
 * thread aislado (ver run-turn): replica el comportamiento clásico.
 */
async function handoffNode(state: AgentStateT, deps: Deps): Promise<Partial<AgentStateT>> {
  const ctx = state.assembled;
  const fr = state.flowResult;
  if (!ctx || !fr?.interrupt) throw new Error('handoff: state missing');
  const { reason, kind, summary } = fr.interrupt;
  const { input } = state;
  const log = deps.logger.child({ turn_id: input.turn_id, node: 'handoff' });

  // Shadow / replay: no se suspende ni se notifica; se cierra como interrupted.
  if (input.dry_run) {
    return {
      flowResult: fr,
      actionResults: [],
      responseTexts: [],
      finalStage: fr.newStage ?? ctx.currentStage,
      status: 'interrupted',
      interruptInfo: null,
    };
  }

  // Guard de re-ejecución: releemos dialogue_states fresco. Si ya está en
  // human_handoff, esta es la pasada de RESUME → saltamos el bloque de suspensión.
  const fresh = await loadDialogueState(deps.db, { conversationId: input.conversation_id });
  const resuming = fresh.repair_context?.pattern === 'human_handoff';
  let notificationId = (fresh.repair_context?.payload as { notification_id?: string } | undefined)
    ?.notification_id;

  if (!resuming) {
    // ── Pasada de SUSPENSIÓN ──
    await pauseSubscriberForHandoff(deps.db, input.subscriber_id);

    const notifResult = await notifyHumanHandler.execute(
      {
        action: 'notify_human',
        config: { kind, reason, summary },
        on_failure: 'continue',
        origin: 'command',
      },
      {
        tenant: ctx.tenant,
        tenantConfig: ctx.tenantConfig,
        subscriber: ctx.subscriber,
        conversationId: input.conversation_id,
        turnId: input.turn_id,
        channel: {
          sendFlow: async () => ({ success: true, statusCode: 0, attempts: 0 }),
          sendText: async () => ({ success: true, statusCode: 0, attempts: 0 }),
          sendContent: async () => ({ success: true, statusCode: 0, attempts: 0 }),
        },
        db: deps.db,
        redis: deps.redis,
        log: deps.logger,
        dryRun: false,
        stageCatalog: ctx.stageCatalog,
        currentStage: ctx.currentStage,
      },
    );
    notificationId = (notifResult.detail as { notification_id?: string }).notification_id;

    const interruptedState = setRepairContext(
      fr.state,
      'human_handoff',
      notificationId ? { notification_id: notificationId } : {},
      new Date().toISOString(),
    );

    // respond NO corre en la suspensión → persistimos el turno aquí.
    await deps.db
      .update(turns)
      .set({
        status: 'interrupted',
        completedAt: sql`now()`,
        durationMs: Date.now() - state.startedAt,
      })
      .where(eq(turns.id, input.turn_id));
    await saveDialogueState(deps.db, {
      conversationId: input.conversation_id,
      tenantId: input.tenant_id,
      state: { ...interruptedState, last_turn_id: input.turn_id },
      turnId: input.turn_id,
    });

    // Traza (ADR-0025): respond no corre en la suspensión → la guardamos aquí.
    const traceLevel = (ctx.tenantConfig.trace_level as TraceLevel | undefined) ?? 'full';
    try {
      await saveTurnTrace(deps.db, {
        state: { ...state, status: 'interrupted', finalStage: fr.newStage ?? ctx.currentStage },
        mode: resolveTraceMode(input),
        status: 'interrupted',
        traceLevel,
        dialogueStateAfter: interruptedState,
      });
    } catch (err) {
      log.error({ err }, 'saveTurnTrace (handoff) failed');
    }

    log.info({ kind, reason, notification_id: notificationId }, 'human handoff — suspending');
  }

  // Suspende el thread (SUSPEND) o devuelve el valor del humano (RESUME).
  const resumeValue = interrupt<HandoffInterruptPayload, HandoffResumeValue>({
    kind,
    reason,
    summary,
    notification_id: notificationId,
  });

  // ── Pasada de RESUME (sólo se llega aquí tras Command) ──
  const continuedState = setRepairContext(
    fr.state,
    'continue_interrupted',
    {
      note: resumeValue?.note ?? '',
      resolved_by: resumeValue?.resolved_by ?? 'human',
      notification_id: notificationId,
    },
    new Date().toISOString(),
  );

  log.info({ resolved_by: resumeValue?.resolved_by }, 'human handoff — resumed');

  return {
    flowResult: { ...fr, state: continuedState },
    actionResults: [],
    responseTexts: [],
    finalStage: fr.newStage ?? ctx.currentStage,
    status: 'completed',
    interruptInfo: notificationId ? { reason, notification_id: notificationId } : null,
  };
}

let compiled: ReturnType<typeof compileAgentGraph> | null = null;

/** Grafo compilado (cacheado por proceso). */
export function getCompiledGraph(deps: Deps): ReturnType<typeof compileAgentGraph> {
  if (!compiled) compiled = compileAgentGraph(deps);
  return compiled;
}

/**
 * Ejecuta un turno con deps explícitos compilando un grafo fresco (uncached).
 * Para scripts/tests (replay) que inyectan clock/rng/db propios. dry_run usa un
 * thread aislado para no tocar el checkpoint real.
 */
export async function runGraph(input: TurnInput, deps: Deps): Promise<AgentResponse> {
  const graph = compileAgentGraph(deps);
  const threadId = input.dry_run
    ? `shadow:${input.conversation_id}:${input.turn_id}`
    : input.conversation_id;
  const finalState = await graph.invoke(initialState(input), {
    configurable: { thread_id: threadId },
    recursionLimit: 50,
  });
  if (!finalState.agentResponse) throw new Error('runGraph: no response produced');
  return finalState.agentResponse;
}
