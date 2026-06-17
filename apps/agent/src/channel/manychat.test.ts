/**
 * Tests de integración para el adaptador HTTP de ManyChat.
 *
 * Objetivo: verificar que el código TypeScript arma correctamente
 * las llamadas HTTP (URL, método, headers, body), maneja errores
 * de API y aplica la política de reintentos — sin necesitar
 * credenciales reales ni tocar el agente.
 *
 * Para probar contra la API real de ManyChat usa las variables
 * MC_API_KEY y MC_SUBSCRIBER_ID en el entorno y ejecuta los tests
 * marcados con .skip comentando el stub de fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDryRunAdapter, createManyChatAdapter } from './manychat.js';

const FAKE_API_KEY = 'test-api-key-for-unit-tests';
const SUBSCRIBER_ID = '987654321';

/** Construye una respuesta fetch simulada */
function mockFetchResponse(status: number, bodyText = '') {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(bodyText),
  } as Response);
}

describe('createManyChatAdapter — sendText', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let adapter: ReturnType<typeof createManyChatAdapter>;

  beforeEach(() => {
    adapter = createManyChatAdapter(FAKE_API_KEY);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('envía POST a /fb/sending/sendContent con el payload correcto', async () => {
    fetchMock.mockReturnValueOnce(mockFetchResponse(200));

    const result = await adapter.sendText('Hola, texto libre de prueba', SUBSCRIBER_ID);

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.attempts).toBe(1);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.manychat.com/fb/sending/sendContent');
    expect(init.method).toBe('POST');

    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${FAKE_API_KEY}`);
    expect(headers['content-type']).toBe('application/json');

    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      subscriber_id: 987654321,
      data: {
        version: 'v2',
        content: {
          type: 'instagram',
          messages: [{ type: 'text', text: 'Hola, texto libre de prueba' }],
          actions: [],
          quick_replies: [],
        },
      },
    });
  });

  it('convierte subscriber_id a número (ManyChat requiere integer)', async () => {
    fetchMock.mockReturnValueOnce(mockFetchResponse(200));
    await adapter.sendText('test', '000111222');
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(typeof body.subscriber_id).toBe('number');
    expect(body.subscriber_id).toBe(111222);
  });

  it('devuelve success: false en 401 sin reintentar', async () => {
    fetchMock.mockReturnValue(mockFetchResponse(401, '{"error":"Unauthorized"}'));

    const result = await adapter.sendText('test', SUBSCRIBER_ID);

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(401);
    expect(result.attempts).toBe(1); // no hubo reintentos
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('devuelve success: false en 403 sin reintentar', async () => {
    fetchMock.mockReturnValue(mockFetchResponse(403, 'Forbidden'));
    const result = await adapter.sendText('test', SUBSCRIBER_ID);
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
  });

  it('devuelve success: false en 404 sin reintentar', async () => {
    fetchMock.mockReturnValue(mockFetchResponse(404, 'Not Found'));
    const result = await adapter.sendText('test', SUBSCRIBER_ID);
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
  });

  it('incluye el cuerpo del error en el resultado', async () => {
    fetchMock.mockReturnValue(mockFetchResponse(400, 'subscriber_id is invalid'));
    const result = await adapter.sendText('test', SUBSCRIBER_ID);
    expect(result.errorBody).toContain('subscriber_id is invalid');
  });

  it('reintenta en 429 y tiene éxito en el segundo intento', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockReturnValueOnce(mockFetchResponse(429, 'Too Many Requests'))
      .mockReturnValueOnce(mockFetchResponse(200));

    const promise = adapter.sendText('retry-text', SUBSCRIBER_ID);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('agota los 3 intentos en errores 500 persistentes', async () => {
    vi.useFakeTimers();
    fetchMock.mockReturnValue(mockFetchResponse(500, 'Internal Server Error'));

    const promise = adapter.sendText('test', SUBSCRIBER_ID);
    await vi.runAllTimersAsync();
    const result = await promise;

    // 1 intento inicial + 2 reintentos = 3 total
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(500);
    expect(result.attempts).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([502, 503, 504])(
    'reintenta en %i y tiene éxito al segundo intento',
    async (errorCode) => {
      vi.useFakeTimers();
      fetchMock
        .mockReturnValueOnce(mockFetchResponse(errorCode))
        .mockReturnValueOnce(mockFetchResponse(200));

      const promise = adapter.sendText('test', SUBSCRIBER_ID);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
      vi.useRealTimers();
    },
  );
});

describe('createManyChatAdapter — sendFlow', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let adapter: ReturnType<typeof createManyChatAdapter>;

  beforeEach(() => {
    adapter = createManyChatAdapter(FAKE_API_KEY);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('envía POST a /fb/sending/sendFlow con subscriber_id y flow_ns', async () => {
    fetchMock.mockReturnValueOnce(mockFetchResponse(200));

    const result = await adapter.sendFlow('content20240615_audio_testimonio', SUBSCRIBER_ID);

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.manychat.com/fb/sending/sendFlow');

    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      subscriber_id: Number(SUBSCRIBER_ID),
      flow_ns: 'content20240615_audio_testimonio',
    });
  });

  it('devuelve success: false en 401 sin reintentar', async () => {
    fetchMock.mockReturnValue(mockFetchResponse(401));
    const result = await adapter.sendFlow('ns', SUBSCRIBER_ID);
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(401);
    expect(result.attempts).toBe(1);
  });

  it('reintenta en 429', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockReturnValueOnce(mockFetchResponse(429))
      .mockReturnValueOnce(mockFetchResponse(200));

    const promise = adapter.sendFlow('ns', SUBSCRIBER_ID);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('agota los reintentos en 500 persistente', async () => {
    vi.useFakeTimers();
    fetchMock.mockReturnValue(mockFetchResponse(500, 'error'));

    const promise = adapter.sendFlow('ns', SUBSCRIBER_ID);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3);
  });
});

describe('createDryRunAdapter', () => {
  it('devuelve success sin llamar a fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const dry = createDryRunAdapter();

    const textResult = await dry.sendText('hola', SUBSCRIBER_ID);
    const flowResult = await dry.sendFlow('ns', SUBSCRIBER_ID);

    expect(textResult.success).toBe(true);
    expect(flowResult.success).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
