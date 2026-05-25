import type { N8nDispatchPayload } from '@dm-api/shared';
import type { Logger } from '../lib/logger.js';

export interface DispatchResult {
  executionId: string | null;
  status: number;
}

export class N8nDispatchError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly retriable: boolean,
  ) {
    super(message);
    this.name = 'N8nDispatchError';
  }
}

/**
 * POST al webhook de n8n con el batch del turn. n8n debe responder
 * 2xx inmediatamente (modo "respond immediately") y procesar async,
 * llamando luego a /admin/turn-completed.
 *
 * Documentación: docs/onboarding/06-integracion-n8n.md.
 */
export async function dispatchToN8n(opts: {
  workflowUrl: string;
  payload: N8nDispatchPayload;
  timeoutMs?: number;
  log: Logger;
}): Promise<DispatchResult> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const log = opts.log.child({ turn_id: opts.payload.turn_id });
  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetch(opts.workflowUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-schema-version': 'v1',
      },
      body: JSON.stringify(opts.payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    log.error({ err, duration_ms: Date.now() - startedAt }, 'n8n dispatch network error');
    throw new N8nDispatchError(
      isTimeout
        ? `n8n dispatch timeout after ${timeoutMs}ms`
        : `n8n dispatch failed: ${String(err)}`,
      null,
      true,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    log.error(
      { status: res.status, body: body.slice(0, 500), duration_ms: Date.now() - startedAt },
      'n8n dispatch non-2xx',
    );
    // 5xx → reintentar; 4xx → no
    const retriable = res.status >= 500;
    throw new N8nDispatchError(
      `n8n responded ${res.status}: ${body.slice(0, 200)}`,
      res.status,
      retriable,
    );
  }

  // n8n suele devolver { executionId: "..." } en modo respond immediately
  let executionId: string | null = null;
  try {
    const body = (await res.json()) as Record<string, unknown>;
    if (typeof body.executionId === 'string') {
      executionId = body.executionId;
    }
  } catch {
    /* ignore: n8n no siempre devuelve JSON */
  }

  log.info(
    { execution_id: executionId, status: res.status, duration_ms: Date.now() - startedAt },
    'dispatched to n8n',
  );

  return { executionId, status: res.status };
}
