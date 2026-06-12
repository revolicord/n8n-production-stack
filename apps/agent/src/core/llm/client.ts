import Anthropic from '@anthropic-ai/sdk';
import type { LlmPlan } from '@dm-api/shared';
import { LlmPlanSchema } from '@dm-api/shared';
import type { Logger } from 'pino';
import { zodToJsonSchema } from 'zod-to-json-schema';

const EMIT_PLAN_TOOL = 'emit_plan';

export interface LlmCallResult {
  plan: LlmPlan;
  inputTokens: number;
  outputTokens: number;
  model: string;
  durationMs: number;
}

export interface LlmCallInput {
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  model: string;
  apiKey: string;
  timeoutMs?: number;
  log: Logger;
}

export async function callLlm(input: LlmCallInput): Promise<LlmCallResult> {
  const client = new Anthropic({
    apiKey: input.apiKey,
    timeout: input.timeoutMs ?? 55_000,
    maxRetries: 1,
  });

  const toolSchema = zodToJsonSchema(LlmPlanSchema, { name: EMIT_PLAN_TOOL, $refStrategy: 'none' });
  const inputSchema =
    (toolSchema as { definitions?: Record<string, unknown>; [k: string]: unknown }).definitions?.[
      EMIT_PLAN_TOOL
    ] ?? (toolSchema as Record<string, unknown>);

  const startedAt = Date.now();

  const response = await client.messages.create({
    model: input.model,
    max_tokens: 2048,
    system: input.systemPrompt,
    messages: input.messages,
    tools: [
      {
        name: EMIT_PLAN_TOOL,
        description: 'Emite el plan de diálogo para este turno',
        input_schema: inputSchema as Anthropic.Tool['input_schema'],
      },
    ],
    tool_choice: { type: 'tool', name: EMIT_PLAN_TOOL },
  });

  const durationMs = Date.now() - startedAt;
  const toolUse = response.content.find((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
  if (!toolUse) {
    throw new Error('LLM did not call emit_plan tool');
  }

  const parseResult = LlmPlanSchema.safeParse(toolUse.input);
  if (!parseResult.success) {
    // One retry with error feedback
    const issues = parseResult.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    input.log.warn({ issues }, 'LLM plan failed first parse, retrying');

    const retryMessages = [
      ...input.messages,
      { role: 'assistant' as const, content: response.content },
      {
        role: 'user' as const,
        content: `Tu plan no pasó la validación. Errores: ${issues}. Vuelve a emitir emit_plan corrigiendo los errores.`,
      },
    ];

    const retryResponse = await client.messages.create({
      model: input.model,
      max_tokens: 2048,
      system: input.systemPrompt,
      messages: retryMessages,
      tools: [
        {
          name: EMIT_PLAN_TOOL,
          description: 'Emite el plan de diálogo para este turno',
          input_schema: inputSchema as Anthropic.Tool['input_schema'],
        },
      ],
      tool_choice: { type: 'tool', name: EMIT_PLAN_TOOL },
    });

    const retryToolUse = retryResponse.content.find(
      (c): c is Anthropic.ToolUseBlock => c.type === 'tool_use',
    );
    if (!retryToolUse) throw new Error('LLM retry did not call emit_plan');

    const retryParse = LlmPlanSchema.safeParse(retryToolUse.input);
    if (!retryParse.success) {
      throw new Error(`LLM plan invalid after retry: ${retryParse.error.message}`);
    }

    return {
      plan: retryParse.data,
      inputTokens: (response.usage.input_tokens ?? 0) + (retryResponse.usage.input_tokens ?? 0),
      outputTokens: (response.usage.output_tokens ?? 0) + (retryResponse.usage.output_tokens ?? 0),
      model: input.model,
      durationMs: Date.now() - startedAt,
    };
  }

  return {
    plan: parseResult.data,
    inputTokens: response.usage.input_tokens ?? 0,
    outputTokens: response.usage.output_tokens ?? 0,
    model: input.model,
    durationMs,
  };
}
