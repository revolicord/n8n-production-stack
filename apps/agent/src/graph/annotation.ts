import type {
  ActionResult,
  AgentResponse,
  DialogueCommand,
  DialogueState,
  TurnInput,
} from '@dm-api/shared';
import { Annotation } from '@langchain/langgraph';
import type { AssembledContext } from '../core/context/assemble.js';
import type { FlowEngineResult } from '../core/flow-engine/engine.js';
import type { FastPathResult } from './nodes/fast-path.js';

/**
 * Camino de decisión del turno. Lo determina el nodo `understand`:
 *  - `fast_path`: el CALM determinista resolvió el turno sin LLM (0 tokens).
 *  - `system`: turno solo de system_commands (webhook), sin LLM (0 tokens).
 *  - `llm`: se llamó a Claude.
 *  - `none`: error antes de decidir (default).
 * Habilita la métrica de ahorro determinista (GET /admin/agent-savings).
 */
export type DecisionPath = 'fast_path' | 'system' | 'llm' | 'none';

export interface LlmCallMetrics {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  llmMs: number;
}

/** Lo exacto que se envió al LLM en este turno (para la traza legible). */
export interface LlmRequestSnapshot {
  /** Prefijo estable del system prompt (cacheado vía cache_control). */
  systemStable: string;
  /** Cola volátil del system prompt (transiciones/contenido/diálogo, sin cache). */
  systemVolatile: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

const lastWrite = <T>(_left: T, right: T): T => right;

/**
 * Estado del grafo LangGraph (ADR-0025). Sostiene lo que antes era la interface
 * `GraphState` + lo que se descartaba (reasoning, prompt, memoria-antes, timings)
 * para poder construir la traza legible en `respond`.
 */
export const AgentState = Annotation.Root({
  input: Annotation<TurnInput>,
  startedAt: Annotation<number>({ reducer: lastWrite, default: () => Date.now() }),
  currentNode: Annotation<string | null>({ reducer: lastWrite, default: () => null }),

  assembled: Annotation<AssembledContext | null>({ reducer: lastWrite, default: () => null }),
  dialogueStateBefore: Annotation<DialogueState | null>({
    reducer: lastWrite,
    default: () => null,
  }),

  fastPath: Annotation<FastPathResult | null>({ reducer: lastWrite, default: () => null }),
  fastPathSkipReason: Annotation<string | null>({ reducer: lastWrite, default: () => null }),
  decisionPath: Annotation<DecisionPath>({ reducer: lastWrite, default: () => 'none' }),
  allCommands: Annotation<DialogueCommand[]>({ reducer: lastWrite, default: () => [] }),
  llmReasoning: Annotation<string | null>({ reducer: lastWrite, default: () => null }),
  llmRequest: Annotation<LlmRequestSnapshot | null>({ reducer: lastWrite, default: () => null }),
  llmMetrics: Annotation<LlmCallMetrics | null>({ reducer: lastWrite, default: () => null }),

  flowResult: Annotation<FlowEngineResult | null>({ reducer: lastWrite, default: () => null }),
  actionResults: Annotation<ActionResult[]>({ reducer: lastWrite, default: () => [] }),
  responseTexts: Annotation<string[]>({ reducer: lastWrite, default: () => [] }),
  finalStage: Annotation<string | null>({ reducer: lastWrite, default: () => null }),

  status: Annotation<AgentResponse['status'] | null>({ reducer: lastWrite, default: () => null }),
  interruptInfo: Annotation<{ reason: string; notification_id: string } | null>({
    reducer: lastWrite,
    default: () => null,
  }),

  agentResponse: Annotation<AgentResponse | null>({ reducer: lastWrite, default: () => null }),
});

export type AgentStateT = typeof AgentState.State;

/**
 * Valores iniciales que se pasan a `graph.invoke`. Resetea TODOS los canales:
 * el thread del checkpointer persiste entre turnos (mismo conversation_id), así
 * que hay que limpiar valores condicionales (status, interruptInfo) para que no
 * arrastren del turno anterior.
 */
export function initialState(input: TurnInput): Partial<AgentStateT> {
  return {
    input,
    startedAt: Date.now(),
    currentNode: null,
    assembled: null,
    dialogueStateBefore: null,
    fastPath: null,
    fastPathSkipReason: null,
    decisionPath: 'none',
    allCommands: [],
    llmReasoning: null,
    llmRequest: null,
    llmMetrics: null,
    flowResult: null,
    actionResults: [],
    responseTexts: [],
    finalStage: null,
    status: null,
    interruptInfo: null,
    agentResponse: null,
  };
}
