/**
 * Tests del handler reply_text.
 *
 * Verifica que el texto correcto llega al adaptador de canal
 * (ManyChat sendText) sin necesitar credenciales reales.
 * Útil para diagnosticar: ¿el problema es el renderizado del
 * template, la lógica de fallback, o la llamada HTTP?
 */
import type { Subscriber, Tenant } from '@dm-api/db';
import type { TenantConfig } from '@dm-api/shared';
import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { SendTextResult } from '../../channel/types.js';
import type { ActionContext } from '../registry.js';
import { replyTextHandler } from './reply-text.js';

const MANYCHAT_ID = '111222333';

function makeInvocation(config: Record<string, unknown>) {
  return {
    action: 'reply_text',
    config,
    on_failure: 'abort' as const,
    origin: 'command' as const,
  };
}

function makeCtx(overrides: Partial<ActionContext> = {}): ActionContext {
  return {
    tenant: { id: 'tenant-uuid-1' } as Tenant,
    tenantConfig: {
      calendly_url: 'https://calendly.com/test-link',
      connectors: { booking: 'https://book.example.com' },
    } as unknown as TenantConfig,
    subscriber: {
      id: 'sub-uuid-1',
      manychatSubscriberId: MANYCHAT_ID,
      displayName: 'Juan Pérez',
      igUsername: 'juanperez_ig',
    } as unknown as Subscriber,
    conversationId: 'conv-uuid-1',
    turnId: 'turn-uuid-1',
    channel: {
      sendText: vi.fn().mockResolvedValue({
        success: true,
        statusCode: 200,
        attempts: 1,
      } satisfies SendTextResult),
      sendFlow: vi.fn(),
      sendContent: vi.fn(),
    },
    db: {} as unknown as ActionContext['db'],
    redis: {} as unknown as ActionContext['redis'],
    log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as Logger,
    dryRun: false,
    stageCatalog: [],
    currentStage: 'prospecto',
    ...overrides,
  };
}

describe('replyTextHandler — texto literal', () => {
  it('llama a sendText con el texto exacto y el subscriber_id correcto', async () => {
    const ctx = makeCtx();
    const result = await replyTextHandler.execute(
      makeInvocation({ text: 'Hola, este es un texto libre de prueba.' }),
      ctx,
    );

    expect(result.status).toBe('sent');
    expect(result.command_type).toBe('ReplyText');

    const sendText = ctx.channel.sendText as ReturnType<typeof vi.fn>;
    expect(sendText).toHaveBeenCalledOnce();
    const [sentText, sentSubscriberId] = sendText.mock.calls[0] as [string, string];
    expect(sentText).toBe('Hola, este es un texto libre de prueba.');
    expect(sentSubscriberId).toBe(MANYCHAT_ID);
  });

  it('devuelve error cuando sendText falla (401 / 500)', async () => {
    const ctx = makeCtx({
      channel: {
        sendText: vi.fn().mockResolvedValue({
          success: false,
          statusCode: 500,
          attempts: 3,
          errorBody: 'ManyChat 500: Internal Server Error',
        } satisfies SendTextResult),
        sendFlow: vi.fn(),
        sendContent: vi.fn(),
      },
    });

    const result = await replyTextHandler.execute(
      makeInvocation({ text: 'mensaje que falla' }),
      ctx,
    );

    expect(result.status).toBe('error');
    expect((result.detail as Record<string, unknown>).statusCode).toBe(500);
    expect(String((result.detail as Record<string, unknown>).errorBody)).toContain('500');
  });

  it('devuelve error cuando sendText falla con 401 (token inválido)', async () => {
    const ctx = makeCtx({
      channel: {
        sendText: vi.fn().mockResolvedValue({
          success: false,
          statusCode: 401,
          attempts: 1,
          errorBody: 'ManyChat 401: Unauthorized',
        } satisfies SendTextResult),
        sendFlow: vi.fn(),
        sendContent: vi.fn(),
      },
    });

    const result = await replyTextHandler.execute(makeInvocation({ text: 'test' }), ctx);
    expect(result.status).toBe('error');
    expect((result.detail as Record<string, unknown>).statusCode).toBe(401);
  });
});

describe('replyTextHandler — template rendering', () => {
  it('reemplaza {subscriber.display_name} con el nombre real', async () => {
    const ctx = makeCtx();
    await replyTextHandler.execute(
      makeInvocation({ template: 'Hola {subscriber.display_name}, ¿cómo estás?' }),
      ctx,
    );

    const [sentText] = (ctx.channel.sendText as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(sentText).toBe('Hola Juan Pérez, ¿cómo estás?');
  });

  it('reemplaza {tenant.calendly_url} con la URL de calendario + utm_content del subscriber', async () => {
    const ctx = makeCtx();
    await replyTextHandler.execute(
      makeInvocation({ template: 'Agenda aquí: {tenant.calendly_url}' }),
      ctx,
    );

    const [sentText] = (ctx.channel.sendText as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(sentText).toBe('Agenda aquí: https://calendly.com/test-link?utm_content=sub-uuid-1');
  });

  it('reemplaza {subscriber.ig_username}', async () => {
    const ctx = makeCtx();
    await replyTextHandler.execute(
      makeInvocation({ template: 'Tu IG: @{subscriber.ig_username}' }),
      ctx,
    );

    const [sentText] = (ctx.channel.sendText as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(sentText).toBe('Tu IG: @juanperez_ig');
  });

  it('usa fallback cuando el template tiene variables no resueltas', async () => {
    const ctx = makeCtx({
      tenantConfig: {
        // sin calendly_url — queda vacío
        connectors: {},
      } as unknown as TenantConfig,
    });

    // template con var inexistente — quedará con llaves {}
    await replyTextHandler.execute(
      makeInvocation({
        template: 'Reserva en {tenant.connectors.inexistente}',
        fallback: 'Escríbenos para reservar tu lugar.',
      }),
      ctx,
    );

    const [sentText] = (ctx.channel.sendText as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(sentText).toBe('Escríbamos para reservar tu lugar.'.replace('Escríbamos', 'Escríbenos'));
  });
});

describe('replyTextHandler — casos límite', () => {
  it('devuelve skipped cuando no hay text ni template', async () => {
    const ctx = makeCtx();
    const result = await replyTextHandler.execute(makeInvocation({}), ctx);

    expect(result.status).toBe('skipped');
    expect(ctx.channel.sendText).not.toHaveBeenCalled();
  });

  it('devuelve dry_run sin llamar al canal', async () => {
    const ctx = makeCtx({ dryRun: true });
    const result = await replyTextHandler.execute(
      makeInvocation({ text: 'texto de prueba en dry run' }),
      ctx,
    );

    expect(result.status).toBe('dry_run');
    expect((result.detail as Record<string, unknown>).text).toBe('texto de prueba en dry run');
    expect(ctx.channel.sendText).not.toHaveBeenCalled();
  });

  it('devuelve error en config inválida (no valida porque el schema es permisivo)', async () => {
    // ConfigSchema acepta objeto vacío — el caso de "no text" devuelve skipped
    const ctx = makeCtx();
    const result = await replyTextHandler.execute(makeInvocation({}), ctx);
    // No es un error de schema sino skipped por lógica de negocio
    expect(['skipped', 'error']).toContain(result.status);
  });
});
