import type { DialogueCommand, TurnInput } from '@dm-api/shared';
import { getAgentConfig } from '../../config.js';
import type { AssembledContext } from '../../core/context/assemble.js';
import { callLlm } from '../../core/llm/client.js';
import { composePrompt } from '../../core/llm/prompt.js';
import type { Deps } from '../../deps.js';
import type { LlmCallMetrics, LlmRequestSnapshot } from '../annotation.js';

export interface UnderstandResult {
  commands: DialogueCommand[];
  reasoning: string | null;
  request: LlmRequestSnapshot | null;
  metrics: LlmCallMetrics | null;
}

export async function understandNode(
  input: TurnInput,
  ctx: AssembledContext,
  deps: Deps,
): Promise<UnderstandResult> {
  const log = deps.logger.child({ turn_id: input.turn_id, node: 'understand' });

  // Skip LLM for pure system events with only deterministic commands
  const hasUserMessages = input.messages.length > 0;
  const onlySystemCommands = !hasUserMessages && input.system_commands.length > 0;
  if (onlySystemCommands) {
    log.info(
      { skipped: true, n_commands: input.system_commands.length },
      'understand skipped (system-only)',
    );
    return { commands: input.system_commands, reasoning: null, request: null, metrics: null };
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

  log.info(
    {
      model: result.model,
      in_tok: result.inputTokens,
      out_tok: result.outputTokens,
      llm_ms: result.durationMs,
      n_commands: commands.length,
    },
    'understand done',
  );
  log.debug({ reasoning: result.plan.reasoning }, 'llm reasoning');

  return {
    commands,
    reasoning: result.plan.reasoning,
    request: { systemPrompt, messages },
    metrics: {
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      llmMs: result.durationMs,
    },
  };
}
