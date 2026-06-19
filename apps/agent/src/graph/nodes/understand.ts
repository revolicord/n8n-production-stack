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

/**
 * Builds the LLM request snapshot (systemPrompt + messages) without calling the
 * API. Returns null for system-only turns that skip the LLM entirely.
 *
 * Called by the `prepare_prompt` graph node so the snapshot is persisted to the
 * LangGraph checkpoint BEFORE the API call — enabling debug visibility even when
 * the LLM call fails (e.g. credit exhaustion).
 */
export function buildLlmRequest(
  input: TurnInput,
  ctx: AssembledContext,
): LlmRequestSnapshot | null {
  const hasUserMessages = input.messages.length > 0;
  const onlySystemCommands = !hasUserMessages && input.system_commands.length > 0;
  if (onlySystemCommands) return null;

  const personaBlock =
    ctx.tenantConfig.persona_prompt ?? 'Sé profesional, conciso y orientado a resultados.';
  const systemPrompt = composePrompt(ctx, personaBlock);

  const transcriptMsgs = ctx.transcript.map((t) => ({
    role: t.role,
    content: t.content,
  }));
  const currentBatchText = input.messages.map((m) => m.text ?? `[${m.content_class}]`).join('\n');
  const messages = [...transcriptMsgs, { role: 'user' as const, content: currentBatchText }];

  return { systemPrompt, messages };
}

/**
 * Calls the LLM using a pre-built request snapshot from state (written by the
 * `prepare_prompt` node). If `prebuiltRequest` is null the turn is system-only
 * and the LLM is skipped entirely.
 */
export async function understandNode(
  input: TurnInput,
  ctx: AssembledContext,
  deps: Deps,
  prebuiltRequest: LlmRequestSnapshot | null,
): Promise<UnderstandResult> {
  const log = deps.logger.child({ turn_id: input.turn_id, node: 'understand' });

  if (prebuiltRequest === null) {
    log.info(
      { skipped: true, n_commands: input.system_commands.length },
      'understand skipped (system-only)',
    );
    return { commands: input.system_commands, reasoning: null, request: null, metrics: null };
  }

  const agentConfig = getAgentConfig();
  const model = ctx.tenantConfig.model ?? agentConfig.ANTHROPIC_MODEL;

  const result = await callLlm({
    systemPrompt: prebuiltRequest.systemPrompt,
    messages: prebuiltRequest.messages,
    model,
    apiKey: agentConfig.ANTHROPIC_API_KEY,
    timeoutMs: agentConfig.AGENT_TIMEOUT_MS,
    log: deps.logger,
  });

  // Anti-anzuelo: `system_authorized` solo puede venir de un system_command inyectado
  // (webhook confiable). Lo saneamos a `false` en lo que emite el LLM para que NUNCA
  // pueda saltarse la validación de transiciones por su cuenta (p. ej. mover C→D porque
  // el lead *diga* que agendó). Ver engine.ts (bypass) y webhook-calendly.ts.
  const llmCommands: DialogueCommand[] = result.plan.commands.map((c) =>
    c.type === 'ChangeStage' ? { ...c, system_authorized: false } : c,
  );
  const commands: DialogueCommand[] = [...input.system_commands, ...llmCommands];

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
    request: prebuiltRequest,
    metrics: {
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      llmMs: result.durationMs,
    },
  };
}
