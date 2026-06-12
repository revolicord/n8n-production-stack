import type { DialogueCommand } from '@dm-api/shared';
import { getAgentConfig } from '../../config.js';
import type { AssembledContext } from '../../core/context/assemble.js';
import { callLlm } from '../../core/llm/client.js';
import { composePrompt } from '../../core/llm/prompt.js';
import type { Deps } from '../../deps.js';
import type { GraphState, LlmCallMetrics } from '../annotation.js';

export interface UnderstandResult {
  commands: DialogueCommand[];
  metrics: LlmCallMetrics | null;
}

export async function understandNode(
  state: GraphState,
  ctx: AssembledContext,
  deps: Deps,
): Promise<UnderstandResult> {
  const { input } = state;

  // Skip LLM for pure system events with only deterministic commands
  const hasUserMessages = input.messages.length > 0;
  const onlySystemCommands = !hasUserMessages && input.system_commands.length > 0;
  if (onlySystemCommands) {
    return { commands: input.system_commands, metrics: null };
  }

  const agentConfig = getAgentConfig();
  const model = ctx.tenantConfig.model ?? agentConfig.ANTHROPIC_MODEL;
  const personaBlock =
    ctx.tenantConfig.persona_prompt ?? 'Sé profesional, conciso y orientado a resultados.';
  const systemPrompt = composePrompt(ctx, personaBlock);

  // Build messages: transcript + current batch
  const transcriptMsgs = ctx.transcript.map((t) => ({
    role: t.role,
    content: t.content,
  }));

  const currentBatchText = input.messages.map((m) => m.text ?? `[${m.content_class}]`).join('\n');

  const messages = [...transcriptMsgs, { role: 'user' as const, content: currentBatchText }];

  const result = await callLlm({
    systemPrompt,
    messages,
    model,
    apiKey: agentConfig.ANTHROPIC_API_KEY,
    timeoutMs: agentConfig.AGENT_TIMEOUT_MS,
    log: deps.logger,
  });

  const commands: DialogueCommand[] = [...input.system_commands, ...result.plan.commands];

  return {
    commands,
    metrics: {
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      llmMs: result.durationMs,
    },
  };
}
