/**
 * Tests del cliente HTTP de Telegram.
 *
 * Verifica que el cliente arma correctamente las llamadas a la
 * Bot API (URL, método, payload, parse_mode), maneja el caso
 * sin token configurado y lanza en errores de API.
 *
 * Útil para diagnosticar: ¿el problema es la formación del
 * mensaje o es el token / chat_id / permisos del bot?
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock de config ANTES de importar el módulo bajo prueba
vi.mock('../config.js', () => ({
  getConfig: vi.fn(),
}));

vi.mock('./logger.js', () => ({
  logger: vi.fn(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() })),
}));

import { getConfig } from '../config.js';
import {
  answerCallbackQuery,
  editMessageReplyMarkup,
  editMessageText,
  escapeHtml,
  sendMessage,
} from './telegram.js';

const TOKEN = 'test-bot-token:12345ABCDE';
const CHAT_ID = '-1001234567890';
const MESSAGE_ID = '42';

function mockTelegramOk(result: Record<string, unknown> = {}) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ ok: true, result }),
  } as unknown as Response);
}

function mockTelegramError(description: string, status = 400) {
  return Promise.resolve({
    ok: true,
    status,
    json: () => Promise.resolve({ ok: false, description }),
  } as unknown as Response);
}

describe('sendMessage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      TELEGRAM_BOT_TOKEN: TOKEN,
      DASHBOARD_PUBLIC_URL: undefined,
    });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('envía POST a la URL correcta de la Bot API', async () => {
    fetchMock.mockReturnValue(mockTelegramOk({ message_id: 99, chat: { id: Number(CHAT_ID) } }));

    await sendMessage({ chatId: CHAT_ID, text: 'Prueba de envío' });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
  });

  it('usa parse_mode HTML y disable_web_page_preview', async () => {
    fetchMock.mockReturnValue(mockTelegramOk({ message_id: 1, chat: { id: 100 } }));

    await sendMessage({ chatId: CHAT_ID, text: 'test' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.parse_mode).toBe('HTML');
    expect(body.disable_web_page_preview).toBe(true);
  });

  it('incluye inline_keyboard cuando se pasan botones', async () => {
    fetchMock.mockReturnValue(mockTelegramOk({ message_id: 5, chat: { id: 100 } }));

    const buttons = [
      [
        { text: '⏸ Pausar bot', callback_data: 'pause:notif-uuid' },
        { text: '✅ Resuelto', callback_data: 'resolve:notif-uuid' },
      ],
    ];

    await sendMessage({ chatId: CHAT_ID, text: 'Escalado', buttons });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.reply_markup).toEqual({ inline_keyboard: buttons });
  });

  it('devuelve messageId y chatId del resultado de Telegram', async () => {
    fetchMock.mockReturnValue(mockTelegramOk({ message_id: 77, chat: { id: 99887766 } }));

    const result = await sendMessage({ chatId: CHAT_ID, text: 'msg' });

    expect(result).not.toBeNull();
    expect(result?.messageId).toBe('77');
    expect(result?.chatId).toBe('99887766');
  });

  it('devuelve null cuando TELEGRAM_BOT_TOKEN está vacío (no falla)', async () => {
    (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      TELEGRAM_BOT_TOKEN: '',
    });

    const result = await sendMessage({ chatId: CHAT_ID, text: 'test' });

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lanza cuando la Bot API devuelve ok: false', async () => {
    fetchMock.mockReturnValue(mockTelegramError('chat not found'));

    await expect(sendMessage({ chatId: CHAT_ID, text: 'test' })).rejects.toThrow('chat not found');
  });
});

describe('editMessageText', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      TELEGRAM_BOT_TOKEN: TOKEN,
    });
    fetchMock = vi.fn().mockReturnValue(mockTelegramOk());
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('llama a editMessageText con chat_id, message_id y texto', async () => {
    await editMessageText({
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
      text: 'Mensaje actualizado',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('editMessageText');
    const body = JSON.parse(init.body as string);
    expect(body.chat_id).toBe(CHAT_ID);
    expect(body.message_id).toBe(Number(MESSAGE_ID));
    expect(body.text).toBe('Mensaje actualizado');
  });
});

describe('editMessageReplyMarkup', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      TELEGRAM_BOT_TOKEN: TOKEN,
    });
    fetchMock = vi.fn().mockReturnValue(mockTelegramOk());
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('llama a editMessageReplyMarkup con los botones actualizados', async () => {
    const newButtons = [[{ text: '▶ Reanudar', callback_data: 'resume:notif-uuid' }]];

    await editMessageReplyMarkup({
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
      buttons: newButtons,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('editMessageReplyMarkup');
    const body = JSON.parse(init.body as string);
    expect(body.reply_markup).toEqual({ inline_keyboard: newButtons });
  });
});

describe('answerCallbackQuery', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      TELEGRAM_BOT_TOKEN: TOKEN,
    });
    fetchMock = vi.fn().mockReturnValue(mockTelegramOk());
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('envía callback_query_id sin texto opcional', async () => {
    await answerCallbackQuery({ callbackQueryId: 'cq-abc-123' });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.callback_query_id).toBe('cq-abc-123');
    expect(body.text).toBeUndefined();
  });

  it('incluye texto opcional cuando se pasa', async () => {
    await answerCallbackQuery({ callbackQueryId: 'cq-abc-123', text: 'Bot pausado ✓' });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.text).toBe('Bot pausado ✓');
  });
});

describe('escapeHtml', () => {
  it('escapa & < >', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml('a > b')).toBe('a &gt; b');
  });

  it('deja intacto texto sin caracteres especiales', () => {
    expect(escapeHtml('Hola Juan Pérez @juanperez_ig')).toBe('Hola Juan Pérez @juanperez_ig');
  });

  it('escapa múltiples ocurrencias', () => {
    expect(escapeHtml('a & b & c')).toBe('a &amp; b &amp; c');
  });
});
