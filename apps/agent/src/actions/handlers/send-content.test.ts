/**
 * Tests del handler send_content.
 *
 * Verifica que dado un slug_id el handler:
 *   1. Busca el flowNs correcto en el catálogo de etapas
 *   2. Llama a channel.sendFlow con el flowNs y el subscriber_id
 *   3. Registra en lead_content_sent cuando tiene éxito
 *
 * Con el mock del canal podemos probar qué flujo de ManyChat se
 * enviaría (audio, video, etc.) sin credenciales reales.
 */
import type { Subscriber, Tenant } from '@dm-api/db';
import type { TenantConfig } from '@dm-api/shared';
import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { SendFlowResult } from '../../channel/types.js';
import type { ActionContext } from '../registry.js';
import { sendContentHandler } from './send-content.js';

// Mock emitDomainEvent para no necesitar DB real
vi.mock('../events.js', () => ({
  emitDomainEvent: vi.fn().mockResolvedValue(undefined),
}));

const MANYCHAT_ID = '555666777';

/** Catálogo mínimo de contenido para pruebas */
const TEST_CATALOG: ActionContext['stageCatalog'] = [
  {
    stageSlug: 'prospecto',
    variants: [
      {
        flowNs: 'content20240101_audio_testimonio',
        slugId: 'QC_MS_AUDIO_TESTIMONIO',
        variantGroup: null,
        timesSent: 0,
        lastSent: null,
      },
      {
        flowNs: 'content20240101_video_demo',
        slugId: 'QC_MS_VIDEO_DEMO',
        variantGroup: null,
        timesSent: 0,
        lastSent: null,
      },
    ],
  },
  {
    stageSlug: 'calificado',
    variants: [
      {
        flowNs: 'content20240601_pdf_propuesta',
        slugId: 'QC_MS_PDF_PROPUESTA',
        variantGroup: null,
        timesSent: 0,
        lastSent: null,
      },
    ],
  },
];

function makeInvocation(config: Record<string, unknown>) {
  return {
    action: 'send_content',
    config,
    on_failure: 'abort' as const,
    origin: 'command' as const,
  };
}

function makeCtx(overrides: Partial<ActionContext> = {}): ActionContext {
  const mockDb = {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    }),
  };

  return {
    tenant: { id: 'tenant-uuid-1' } as Tenant,
    tenantConfig: {} as TenantConfig,
    subscriber: {
      id: 'sub-uuid-1',
      manychatSubscriberId: MANYCHAT_ID,
      displayName: 'Maria García',
      igUsername: 'mgarcia',
    } as unknown as Subscriber,
    conversationId: 'conv-uuid-1',
    turnId: 'turn-uuid-1',
    channel: {
      sendFlow: vi.fn().mockResolvedValue({
        success: true,
        statusCode: 200,
        attempts: 1,
      } satisfies SendFlowResult),
      sendText: vi.fn(),
      sendContent: vi.fn(),
    },
    db: mockDb as unknown as ActionContext['db'],
    redis: {} as unknown as ActionContext['redis'],
    log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as Logger,
    dryRun: false,
    stageCatalog: TEST_CATALOG,
    currentStage: 'prospecto',
    ...overrides,
  };
}

describe('sendContentHandler — happy path', () => {
  it('llama a sendFlow con el flowNs correcto para un slug_id de audio', async () => {
    const ctx = makeCtx();
    const result = await sendContentHandler.execute(
      makeInvocation({ slug_id: 'QC_MS_AUDIO_TESTIMONIO' }),
      ctx,
    );

    expect(result.status).toBe('sent');
    expect(result.command_type).toBe('SendContent');

    const sendFlow = ctx.channel.sendFlow as ReturnType<typeof vi.fn>;
    expect(sendFlow).toHaveBeenCalledOnce();
    const [flowNs, subscriberId] = sendFlow.mock.calls[0] as [string, string];
    expect(flowNs).toBe('content20240101_audio_testimonio');
    expect(subscriberId).toBe(MANYCHAT_ID);
  });

  it('llama a sendFlow con el flowNs correcto para un slug_id de video', async () => {
    const ctx = makeCtx();
    await sendContentHandler.execute(makeInvocation({ slug_id: 'QC_MS_VIDEO_DEMO' }), ctx);

    const [flowNs] = (ctx.channel.sendFlow as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(flowNs).toBe('content20240101_video_demo');
  });

  it('busca en la etapa correcta cuando se especifica lookup_stage', async () => {
    const ctx = makeCtx({ currentStage: 'prospecto' });
    const result = await sendContentHandler.execute(
      makeInvocation({ slug_id: 'QC_MS_PDF_PROPUESTA', lookup_stage: 'calificado' }),
      ctx,
    );

    expect(result.status).toBe('sent');
    const [flowNs] = (ctx.channel.sendFlow as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(flowNs).toBe('content20240601_pdf_propuesta');
  });

  it('registra en lead_content_sent después de envío exitoso', async () => {
    const ctx = makeCtx();
    await sendContentHandler.execute(makeInvocation({ slug_id: 'QC_MS_AUDIO_TESTIMONIO' }), ctx);

    const db = ctx.db as unknown as { insert: ReturnType<typeof vi.fn> };
    // Al menos una llamada insert (lead_content_sent) + otra de emitDomainEvent (mockeado)
    expect(db.insert).toHaveBeenCalled();
  });
});

describe('sendContentHandler — slug no encontrado', () => {
  it('devuelve status skipped cuando el slug_id no existe en el catálogo', async () => {
    const ctx = makeCtx();
    const result = await sendContentHandler.execute(
      makeInvocation({ slug_id: 'QC_MS_SLUG_INEXISTENTE' }),
      ctx,
    );

    expect(result.status).toBe('skipped');
    expect((result.detail as Record<string, unknown>).reason).toBe('slug_not_found');
    expect((result.detail as Record<string, unknown>).slug_id).toBe('QC_MS_SLUG_INEXISTENTE');
    expect(ctx.channel.sendFlow).not.toHaveBeenCalled();
  });

  it('devuelve skipped cuando el slug existe en otra etapa (no la actual)', async () => {
    const ctx = makeCtx({ currentStage: 'prospecto' });
    // QC_MS_PDF_PROPUESTA solo está en 'calificado', no en 'prospecto'
    const result = await sendContentHandler.execute(
      makeInvocation({ slug_id: 'QC_MS_PDF_PROPUESTA' }),
      ctx,
    );

    expect(result.status).toBe('skipped');
  });
});

describe('sendContentHandler — modo dry run', () => {
  it('devuelve dry_run sin llamar al canal', async () => {
    const ctx = makeCtx({ dryRun: true });
    const result = await sendContentHandler.execute(
      makeInvocation({ slug_id: 'QC_MS_AUDIO_TESTIMONIO' }),
      ctx,
    );

    expect(result.status).toBe('dry_run');
    expect((result.detail as Record<string, unknown>).flow_ns).toBe(
      'content20240101_audio_testimonio',
    );
    expect(ctx.channel.sendFlow).not.toHaveBeenCalled();
  });
});

describe('sendContentHandler — error de API ManyChat', () => {
  it('devuelve status error cuando sendFlow falla (401)', async () => {
    const ctx = makeCtx({
      channel: {
        sendFlow: vi.fn().mockResolvedValue({
          success: false,
          statusCode: 401,
          attempts: 1,
          errorBody: 'ManyChat 401: Unauthorized',
        } satisfies SendFlowResult),
        sendText: vi.fn(),
        sendContent: vi.fn(),
      },
    });

    const result = await sendContentHandler.execute(
      makeInvocation({ slug_id: 'QC_MS_AUDIO_TESTIMONIO' }),
      ctx,
    );

    expect(result.status).toBe('error');
    expect(result.attempts).toBe(1);
  });

  it('devuelve status error cuando sendFlow falla después de reintentos (500)', async () => {
    const ctx = makeCtx({
      channel: {
        sendFlow: vi.fn().mockResolvedValue({
          success: false,
          statusCode: 500,
          attempts: 3,
          errorBody: 'ManyChat 500: Internal Server Error',
        } satisfies SendFlowResult),
        sendText: vi.fn(),
        sendContent: vi.fn(),
      },
    });

    const result = await sendContentHandler.execute(
      makeInvocation({ slug_id: 'QC_MS_AUDIO_TESTIMONIO' }),
      ctx,
    );

    expect(result.status).toBe('error');
    expect(result.attempts).toBe(3);
  });
});

describe('sendContentHandler — config inválida', () => {
  it('devuelve error cuando falta slug_id', async () => {
    const ctx = makeCtx();
    const result = await sendContentHandler.execute(makeInvocation({}), ctx);

    expect(result.status).toBe('error');
    expect((result.detail as Record<string, unknown>).error).toBe('invalid config');
    expect(ctx.channel.sendFlow).not.toHaveBeenCalled();
  });

  it('devuelve error cuando slug_id es string vacío', async () => {
    const ctx = makeCtx();
    const result = await sendContentHandler.execute(makeInvocation({ slug_id: '' }), ctx);
    expect(result.status).toBe('error');
  });
});
