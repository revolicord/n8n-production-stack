import Anthropic from '@anthropic-ai/sdk';
import type { LlmPlan } from '@dm-api/shared';
import { LlmPlanSchema } from '@dm-api/shared';
import { wrapAnthropic } from 'langsmith/wrappers/anthropic';
import type { Logger } from 'pino';
import { zodToJsonSchema } from 'zod-to-json-schema';

const EMIT_PLAN_TOOL = 'emit_plan';

/** Tokens servidos desde el cache de prompt (cobrados al ~10%). */
function cacheRead(usage: Anthropic.Usage): number {
  return usage.cache_read_input_tokens ?? 0;
}

/** Tokens escritos al cache de prompt en esta llamada (cobrados al ~125%). */
function cacheWrite(usage: Anthropic.Usage): number {
  return usage.cache_creation_input_tokens ?? 0;
}

export interface LlmCallResult {
  plan: LlmPlan;
  inputTokens: number;
  outputTokens: number;
  /** Tokens de input servidos desde cache (cobrados al ~10%). */
  cacheReadTokens: number;
  /** Tokens de input escritos al cache en esta llamada (cobrados al ~125%). */
  cacheWriteTokens: number;
  model: string;
  durationMs: number;
}

export interface LlmCallInput {
  /** Prefijo estable del system prompt: vocabulario + reglas + persona (cacheado). */
  systemStable: string;
  /** Cola volátil: transiciones/contenido/diálogo (sin cache). */
  systemVolatile: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  model: string;
  apiKey: string;
  timeoutMs?: number;
  log: Logger;
}

export async function callLlm(input: LlmCallInput): Promise<LlmCallResult> {
  const client = wrapAnthropic(
    new Anthropic({
      apiKey: input.apiKey,
      timeout: input.timeoutMs ?? 55_000,
      maxRetries: 1,
    }),
  );

  const toolSchema = zodToJsonSchema(LlmPlanSchema, { name: EMIT_PLAN_TOOL, $refStrategy: 'none' });
  const inputSchema =
    (toolSchema as { definitions?: Record<string, unknown>; [k: string]: unknown }).definitions?.[
      EMIT_PLAN_TOOL
    ] ?? (toolSchema as Record<string, unknown>);

  // Prompt caching: el tool schema + el prefijo estable del system son idénticos
  // turno a turno → un breakpoint `ephemeral` en cada uno los cobra al ~10% en
  // cache hits (ventana de 5 min, reaprovechable entre turnos y leads del tenant).
  // La cola volátil (transiciones/contenido/diálogo) queda fuera del prefijo cacheado.
  const tools: Anthropic.Tool[] = [
    {
      name: EMIT_PLAN_TOOL,
      description: 'Emite el plan de diálogo para este turno',
      input_schema: inputSchema as Anthropic.Tool['input_schema'],
      cache_control: { type: 'ephemeral' },
    },
  ];
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: input.systemStable, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: input.systemVolatile },
  ];

  const startedAt = Date.now();

  const response = await client.messages.create({
    model: input.model,
    max_tokens: 2048,
    system,
    messages: input.messages,
    tools,
    tool_choice: { type: 'tool', name: EMIT_PLAN_TOOL },
  });

  const durationMs = Date.now() - startedAt;
  const toolUse = response.content.find(
    (c: Anthropic.ContentBlock): c is Anthropic.ToolUseBlock => c.type === 'tool_use',
  );
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
      system,
      messages: retryMessages,
      tools,
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
      cacheReadTokens: cacheRead(response.usage) + cacheRead(retryResponse.usage),
      cacheWriteTokens: cacheWrite(response.usage) + cacheWrite(retryResponse.usage),
      model: input.model,
      durationMs: Date.now() - startedAt,
    };
  }

  return {
    plan: parseResult.data,
    inputTokens: response.usage.input_tokens ?? 0,
    outputTokens: response.usage.output_tokens ?? 0,
    cacheReadTokens: cacheRead(response.usage),
    cacheWriteTokens: cacheWrite(response.usage),
    model: input.model,
    durationMs,
  };
}
