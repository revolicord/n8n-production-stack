import { TurnCompletedSchema } from '@dm-api/shared';
import type { FastifyInstance } from 'fastify';
import { getConfig } from '../../config.js';
import { verifyAdminAuth } from '../../lib/admin-auth.js';
import { getDb } from '../../lib/db.js';
import { getProcessBatchQueue } from '../../lib/queue.js';
import { getRedis } from '../../lib/redis.js';
import { touchBotMsg } from '../../services/conversations.js';
import { getBufferLength } from '../../services/debounce.js';
import { releaseTurnLock } from '../../services/lock.js';
import { completeTurn } from '../../services/turns.js';

export default async function turnCompletedRoute(app: FastifyInstance): Promise<void> {
  const config = getConfig();

  app.post('/admin/turn-completed', async (req, reply) => {
    if (!(await verifyAdminAuth(req, app))) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
    }

    const parsed = TurnCompletedSchema.safeParse(req.body);
    if (!parsed.success) {
      req.log.warn({ issues: parsed.error.issues }, 'turn-completed payload invalid');
      return reply.code(400).send({
        error: { code: 'INVALID_PAYLOAD', details: parsed.error.issues },
      });
    }
    const payload = parsed.data;

    const turn = await completeTurn(getDb(), {
      turnId: payload.turn_id,
      status: payload.status,
      responseText: payload.response_text ?? null,
      inputTokens: payload.input_tokens ?? null,
      outputTokens: payload.output_tokens ?? null,
      costUsd: payload.cost_usd ?? null,
      llmModel: payload.model ?? null,
      promptVersion: payload.prompt_version ?? null,
      n8nExecutionId: payload.n8n_execution_id ?? null,
      error: payload.error ?? null,
    });

    if (!turn) {
      req.log.warn({ turn_id: payload.turn_id }, 'turn not found in callback');
      return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    }

    if (payload.status === 'completed' || payload.status === 'failed') {
      await touchBotMsg(getDb(), turn.conversationId);
    }

    // Liberar lock solo si es nuestro turno
    await releaseTurnLock(getRedis(), {
      tenantId: turn.tenantId,
      subscriberId: turn.subscriberId,
      turnId: turn.id,
    });

    // ¿Llegaron mensajes mientras n8n procesaba? Disparar nuevo turno.
    const pending = await getBufferLength(getRedis(), {
      tenantId: turn.tenantId,
      subscriberId: turn.subscriberId,
    });
    if (pending > 0) {
      const newToken = crypto.randomUUID();
      await getRedis().set(
        `debounce:${turn.tenantId}:${turn.subscriberId}`,
        newToken,
        'PX',
        config.DEBOUNCE_MS,
      );
      await getProcessBatchQueue().add(
        'process-batch',
        {
          tenantId: turn.tenantId,
          subscriberId: turn.subscriberId,
          token: newToken,
          reason: 'post_lock_drain',
        },
        {
          delay: 100,
          jobId: `dbnc:${turn.tenantId}:${turn.subscriberId}:${newToken}`,
        },
      );
      req.log.info({ pending, turn_id: turn.id }, 'post-lock drain enqueued');
    }

    req.log.info(
      {
        turn_id: turn.id,
        status: payload.status,
        cost_usd: payload.cost_usd,
        duration_ms: turn.durationMs,
      },
      'turn completed',
    );

    return reply.code(204).send();
  });
}
