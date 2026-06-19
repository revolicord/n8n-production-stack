import type { TurnInput } from '@dm-api/shared';
import { describe, expect, it } from 'vitest';
import type { AssembledContext } from '../core/context/assemble.js';
import type { FlowEngineResult } from '../core/flow-engine/engine.js';
import type { Deps } from '../deps.js';
import { executeActionsNode } from '../graph/nodes/execute-actions.js';

const noopLogger = {
  child: () => noopLogger,
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  // biome-ignore lint/suspicious/noExplicitAny: test stub
} as any;

function makeDeps(): Deps {
  // biome-ignore lint/suspicious/noExplicitAny: minimal stub; dry_run handlers don't touch db/redis
  return { logger: noopLogger, db: {} as any, redis: {} as any } as Deps;
}

const STAGE_CATALOG = [
  { stageSlug: 'A', variants: [{ slugId: 'audio_hook', flowNs: 'ns_audio_hook', timesSent: 0 }] },
  { stageSlug: 'MS', variants: [{ slugId: 'video_vsl', flowNs: 'ns_video_vsl', timesSent: 0 }] },
];

function makeCtx(overrides: Partial<AssembledContext> = {}): AssembledContext {
  return {
    tenant: { id: 'tenant-1' },
    // flow_only en la etapa actual por defecto en este archivo
    tenantConfig: { text_policy_by_stage: { A: 'flow_only', MS: 'flow_only' } },
    subscriber: { id: 'sub-1', manychatSubscriberId: 'mc-1' },
    stageCatalog: STAGE_CATALOG,
    currentStage: 'A',
    ...overrides,
    // biome-ignore lint/suspicious/noExplicitAny: only the fields read by the node matter
  } as any;
}

function makeInput(): TurnInput {
  return {
    turn_id: 't-1',
    tenant_id: 'tenant-1',
    subscriber_id: 'sub-1',
    conversation_id: 'c-1',
    dry_run: true,
    trigger: { channel: 'instagram' },
    messages: [],
    system_commands: [],
    // biome-ignore lint/suspicious/noExplicitAny: partial TurnInput stub
  } as any;
}

function flowResult(
  invocations: FlowEngineResult['invocations'],
  newStage: string | null = null,
): FlowEngineResult {
  return {
    state: { version: 1, stack: [], slots: {}, repair_context: null, last_turn_id: null },
    invocations,
    pendingCollect: null,
    interrupt: null,
    newStage,
  };
}

describe('flow_only policy (camino feliz sin texto del LLM)', () => {
  it('suprime el ReplyText improvisado del LLM cuando el flow entrega contenido', async () => {
    const fr = flowResult([
      {
        action: 'send_content',
        config: { slug_id: 'audio_hook' },
        on_failure: 'abort',
        origin: 'flow',
      },
      {
        action: 'reply_text',
        config: { text: '¡genial! aquí te va el audio 🙌' },
        on_failure: 'abort',
        origin: 'command',
      },
    ]);

    const out = await executeActionsNode(makeInput(), fr, makeCtx(), makeDeps());

    // El contenido salió, la cháchara del LLM NO.
    expect(out.responseTexts).toEqual([]);
    const sentContent = out.results.find((r) => r.command_type === 'SendContent');
    expect(sentContent?.status).toBe('dry_run');
    const replied = out.results.find((r) => r.command_type === 'ReplyText');
    expect(replied).toBeUndefined();
  });

  it('NO suprime el reply_text scripted del flow (origin:flow, p. ej. link Calendly)', async () => {
    const fr = flowResult([
      {
        action: 'send_content',
        config: { slug_id: 'audio_hook' },
        on_failure: 'abort',
        origin: 'flow',
      },
      {
        action: 'reply_text',
        config: { text: 'Agenda aquí: https://calendly.com/x' },
        on_failure: 'abort',
        origin: 'flow',
      },
    ]);

    const out = await executeActionsNode(makeInput(), fr, makeCtx(), makeDeps());

    expect(out.responseTexts).toContain('Agenda aquí: https://calendly.com/x');
  });

  it('NO suprime el texto ante un desvío (no hubo salida de flow)', async () => {
    const fr = flowResult([
      {
        action: 'reply_text',
        config: { text: 'Buena pregunta: el sistema funciona así...' },
        on_failure: 'abort',
        origin: 'command',
      },
    ]);

    const out = await executeActionsNode(makeInput(), fr, makeCtx(), makeDeps());

    // Sin send_content ni reply_text de flow → es un desvío → el texto sobrevive.
    expect(out.responseTexts).toEqual(['Buena pregunta: el sistema funciona así...']);
  });

  it('en etapa text_ok el texto del LLM sí acompaña al contenido', async () => {
    const fr = flowResult([
      {
        action: 'send_content',
        config: { slug_id: 'audio_hook' },
        on_failure: 'abort',
        origin: 'flow',
      },
      {
        action: 'reply_text',
        config: { text: 'mira esto' },
        on_failure: 'abort',
        origin: 'command',
      },
    ]);
    const ctx = makeCtx({
      // biome-ignore lint/suspicious/noExplicitAny: partial tenantConfig
      tenantConfig: { text_policy_by_stage: { A: 'text_ok' } } as any,
    });

    const out = await executeActionsNode(makeInput(), fr, ctx, makeDeps());

    expect(out.responseTexts).toContain('mira esto');
  });

  it('dedup booking: el SendContent del LLM que duplica el contenido del flow se descarta, el texto del agente se conserva', async () => {
    // Escenario real post-agendar (etapa D, text_ok): el StartFlow del evento
    // entrega audio + video (origin:flow) y el LLM, consciente del booking, emite
    // su PROPIO SendContent(audio) + ReplyText. El audio NO debe salir dos veces.
    const fr = flowResult([
      // LLM (Fase 1, origin:command) — va primero en el array
      {
        action: 'send_content',
        config: { slug_id: 'audio_hook' },
        on_failure: 'abort',
        origin: 'command',
      },
      {
        action: 'reply_text',
        config: { text: 'Confirmado. Te veo el miércoles a las 07:30.' },
        on_failure: 'abort',
        origin: 'command',
      },
      // Flow (Fase 2, origin:flow) — audio + "video"
      {
        action: 'send_content',
        config: { slug_id: 'audio_hook' },
        on_failure: 'continue',
        origin: 'flow',
      },
      {
        action: 'reply_text',
        config: { text: '🎥 Mira este video: https://youtu.be/x' },
        on_failure: 'abort',
        origin: 'flow',
      },
    ]);
    const ctx = makeCtx({
      // biome-ignore lint/suspicious/noExplicitAny: partial tenantConfig
      tenantConfig: { text_policy_by_stage: { A: 'text_ok' } } as any,
    });

    const out = await executeActionsNode(makeInput(), fr, ctx, makeDeps());

    // El audio sale UNA sola vez (el del flow; el del LLM se dedupe).
    const audios = out.results.filter((r) => r.command_type === 'SendContent');
    expect(audios).toHaveLength(1);

    // El texto contextual del agente se conserva, además del link de video del flow.
    expect(out.responseTexts).toContain('Confirmado. Te veo el miércoles a las 07:30.');
    expect(out.responseTexts).toContain('🎥 Mira este video: https://youtu.be/x');

    // Orden final de lo que llega al lead: texto del agente → audio → video.
    const visibleOrder = out.results
      .filter(
        (r) =>
          (r.command_type === 'ReplyText' || r.command_type === 'SendContent') &&
          (r.status === 'sent' || r.status === 'dry_run'),
      )
      .map((r) =>
        r.command_type === 'SendContent'
          ? 'audio'
          : (r.detail as { text?: string }).text?.startsWith('🎥')
            ? 'video'
            : 'texto',
      );
    expect(visibleOrder).toEqual(['texto', 'audio', 'video']);
  });

  it('content-first: un ChangeStage silencioso a una etapa con contenido envía el contenido, no texto', async () => {
    // ChangeStage a MS sin que el cascade haya empujado send_content.
    const fr = flowResult(
      [
        {
          action: 'change_stage',
          config: { to_stage: 'MS', evidence: '👍' },
          on_failure: 'abort',
          origin: 'command',
        },
      ],
      'MS',
    );

    const out = await executeActionsNode(makeInput(), fr, makeCtx(), makeDeps());

    const contentGuardrail = out.results.find(
      (r) => (r.detail as { guardrail?: string }).guardrail === 'no_reply_content',
    );
    expect(contentGuardrail).toBeDefined();
    expect(contentGuardrail?.command_type).toBe('SendContent');
    // No cae al texto genérico porque el contenido cubrió el turno.
    const textGuardrail = out.results.find(
      (r) => (r.detail as { guardrail?: string }).guardrail === 'no_reply',
    );
    expect(textGuardrail).toBeUndefined();
    expect(out.responseTexts).toEqual([]);
  });
});
