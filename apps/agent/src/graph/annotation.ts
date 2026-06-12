import type {
  ActionResult,
  AgentResponse,
  DialogueCommand,
  LlmPlan,
  TurnInput,
} from '@dm-api/shared';
import type { AssembledContext } from '../core/context/assemble.js';
import type { FlowEngineResult } from '../core/flow-engine/engine.js';

export interface LlmCallMetrics {
  model: string;
  inputTokens: number;
  outputTokens: number;
  llmMs: number;
}

export interface GraphState {
  input: TurnInput;
  assembled: AssembledContext | null;
  llmPlan: LlmPlan | null;
  allCommands: DialogueCommand[];
  flowResult: FlowEngineResult | null;
  actionResults: ActionResult[];
  responseTested: string[];
  llmMetrics: LlmCallMetrics | null;
  agentResponse: AgentResponse | null;
  startedAt: number;
}

export function initialState(input: TurnInput): GraphState {
  return {
    input,
    assembled: null,
    llmPlan: null,
    allCommands: [],
    flowResult: null,
    actionResults: [],
    responseTested: [],
    llmMetrics: null,
    agentResponse: null,
    startedAt: Date.now(),
  };
}
