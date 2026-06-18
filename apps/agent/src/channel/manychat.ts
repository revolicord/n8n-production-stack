import type {
  ChannelAdapter,
  ContentMessage,
  SendContentResult,
  SendFlowResult,
  SendTextResult,
} from './types.js';

const MANYCHAT_BASE = 'https://api.manychat.com';
const RETRIABLE_CODES = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS = [500, 1500];
const TIMEOUT_MS = 30_000;

async function withRetry<T>(
  fn: () => Promise<T>,
  isRetriable: (err: unknown) => boolean,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const delay = RETRY_DELAYS[attempt];
      if (!isRetriable(err) || delay === undefined) throw err;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

class ManyChatError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly retriable: boolean,
  ) {
    super(message);
    this.name = 'ManyChatError';
  }
}

async function post(path: string, body: unknown, apiKey: string): Promise<{ statusCode: number }> {
  const res = await fetch(`${MANYCHAT_BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const retriable = RETRIABLE_CODES.has(res.status);
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      // ignore
    }
    throw new ManyChatError(`ManyChat ${res.status}: ${detail}`, res.status, retriable);
  }
  return { statusCode: res.status };
}

export function createManyChatAdapter(apiKey: string): ChannelAdapter {
  return {
    async sendFlow(flowNs, manychatSubscriberId): Promise<SendFlowResult> {
      let attempts = 0;
      try {
        await withRetry(
          async () => {
            attempts++;
            await post(
              '/fb/sending/sendFlow',
              { subscriber_id: Number(manychatSubscriberId), flow_ns: flowNs },
              apiKey,
            );
          },
          (e) => e instanceof ManyChatError && e.retriable,
        );
        return { success: true, statusCode: 200, attempts };
      } catch (err) {
        const code = err instanceof ManyChatError ? err.statusCode : 0;
        const errorBody = err instanceof Error ? err.message : String(err);
        return { success: false, statusCode: code, attempts, errorBody };
      }
    },

    async sendText(text, manychatSubscriberId): Promise<SendTextResult> {
      let attempts = 0;
      try {
        await withRetry(
          async () => {
            attempts++;
            await post(
              '/fb/sending/sendContent',
              {
                subscriber_id: Number(manychatSubscriberId),
                data: {
                  version: 'v2',
                  content: {
                    type: 'instagram',
                    messages: [{ type: 'text', text }],
                    actions: [],
                    quick_replies: [],
                  },
                },
              },
              apiKey,
            );
          },
          (e) => e instanceof ManyChatError && e.retriable,
        );
        return { success: true, statusCode: 200, attempts };
      } catch (err) {
        const code = err instanceof ManyChatError ? err.statusCode : 0;
        const errorBody = err instanceof Error ? err.message : String(err);
        return { success: false, statusCode: code, attempts, errorBody };
      }
    },

    async sendContent(messages, manychatSubscriberId): Promise<SendContentResult> {
      let attempts = 0;
      try {
        await withRetry(
          async () => {
            attempts++;
            await post(
              '/fb/sending/sendContent',
              {
                subscriber_id: Number(manychatSubscriberId),
                data: {
                  version: 'v2',
                  content: {
                    type: 'instagram',
                    messages: toManyChatMessages(messages),
                    actions: [],
                    quick_replies: [],
                  },
                },
              },
              apiKey,
            );
          },
          (e) => e instanceof ManyChatError && e.retriable,
        );
        return { success: true, statusCode: 200, attempts };
      } catch (err) {
        const code = err instanceof ManyChatError ? err.statusCode : 0;
        const errorBody = err instanceof Error ? err.message : String(err);
        return { success: false, statusCode: code, attempts, errorBody };
      }
    },
  };
}

/** Traduce los `ContentMessage` internos al shape v2 de ManyChat. */
function toManyChatMessages(
  messages: ContentMessage[],
): Array<{ type: 'text'; text: string } | { type: 'image'; url: string }> {
  return messages.map((m) =>
    m.type === 'image' ? { type: 'image', url: m.url } : { type: 'text', text: m.text },
  );
}

export function createDryRunAdapter(): ChannelAdapter {
  return {
    async sendFlow(_flowNs, _subscriberId): Promise<SendFlowResult> {
      return { success: true, statusCode: 0, attempts: 0 };
    },
    async sendText(_text, _subscriberId): Promise<SendTextResult> {
      return { success: true, statusCode: 0, attempts: 0 };
    },
    async sendContent(_messages, _subscriberId): Promise<SendContentResult> {
      return { success: true, statusCode: 0, attempts: 0 };
    },
  };
}
