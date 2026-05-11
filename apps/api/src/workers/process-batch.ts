import { randomUUID } from 'node:crypto';
import type { N8nDispatchPayload } from '@dm-api/shared';
import type { Job } from 'bullmq';
import { getConfig } from '../config.js';
import { getDb } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import type { ProcessBatchJobData } from '../lib/queue.js';
import { getRedis } from '../lib/redis.js';
import { getOrCreateOpenConversation, touchUserMsg } from '../services/conversations.js';
import {
  clearFirstMsg,
  drainBuffer,
  getDebounceToken,
  getFirstMsgTs,
} from '../services/debounce.js';
import { N8nDispatchError, dispatchToN8n } from '../services/dispatch-n8n.js';
import { releaseTurnLock, tryAcquireTurnLock } from '../services/lock.js';
import { getSubscriberById } from '../services/subscribers.js';
import { getTenantById, parseTenantConfig } from '../services/tenants.js';
import { createTurn, markTurnDispatched, markTurnFailed } from '../services/turns.js';

export interface ProcessBatchResult {
  status: 'dispatched' | 'skipped';
  reason?: string;
  turn_id?: string;
  batch_size?: number;
}

export async function processBatchJob(job: Job<ProcessBatchJobData>): Promise<ProcessBatchResult> {
  const { tenantId, subscriberId, token, reason } = job.data;
  const config = getConfig();
  const log = logger().child({
    job_id: job.id,
    tenant_id: tenantId,
    subscriber_id: subscriberId,
    token,
    reason,
  });

  // 1. Token check (cancelación atómica)
  const currentToken = await getDebounceToken(getRedis(), { tenantId, subscriberId });
  const firstMsgTs = await getFirstMsgTs(getRedis(), { tenantId, subscriberId });
  const exceededMaxWait = firstMsgTs !== null && Date.now() - firstMsgTs >= config.MAX_WAIT_MS;
  const isForced = reason === 'hard_limit' || reason === 'post_lock_drain';
  const isLatest = currentToken === token;

  if (!isLatest && !exceededMaxWait && !isForced) {
    log.debug({ current_token: currentToken }, 'stale token, skipping');
    return { status: 'skipped', reason: 'stale' };
  }

  // 2. Adquirir lock de turno
  const turnId = randomUUID();
  const acquired = await tryAcquireTurnLock(getRedis(), {
    tenantId,
    subscriberId,
    turnId,
    ttlMs: config.LOCK_TTL_MS,
  });
  if (!acquired) {
    log.debug('turn locked, will be handled by post-lock drain');
    return { status: 'skipped', reason: 'locked' };
  }

  try {
    // 3. Drenar buffer atómicamente
    const messages = await drainBuffer(getRedis(), { tenantId, subscriberId });
    await clearFirstMsg(getRedis(), { tenantId, subscriberId });

    if (messages.length === 0) {
      await releaseTurnLock(getRedis(), { tenantId, subscriberId, turnId });
      log.debug('buffer empty after drain');
      return { status: 'skipped', reason: 'empty' };
    }

    // 4. Cargar tenant + subscriber + conversación
    const tenant = await getTenantById(getDb(), tenantId);
    if (!tenant) {
      await releaseTurnLock(getRedis(), { tenantId, subscriberId, turnId });
      throw new Error(`tenant ${tenantId} not found`);
    }
    const subscriber = await getSubscriberById(getDb(), { tenantId, subscriberId });
    if (!subscriber) {
      await releaseTurnLock(getRedis(), { tenantId, subscriberId, turnId });
      throw new Error(`subscriber ${subscriberId} not found`);
    }

    const tenantConfig = parseTenantConfig(tenant.config);
    const workflowUrl = tenantConfig.n8n_workflow_url;
    if (!workflowUrl) {
      await releaseTurnLock(getRedis(), { tenantId, subscriberId, turnId });
      log.error('tenant has no n8n_workflow_url configured');
      throw new Error('tenant.config.n8n_workflow_url missing');
    }

    const conversation = await getOrCreateOpenConversation(getDb(), {
      tenantId,
      subscriberId,
    });

    // 5. Insertar turn pending
    const batchText = messages
      .map((m) => {
        if (m.reply_type === 'thumbs_up') return '👍 [pulgar arriba]';
        if (m.media_urls.length > 0 && !m.text) return `[${m.reply_type ?? 'media'} recibido]`;
        return m.text ?? '[mensaje sin texto]';
      })
      .join('\n');
    const firstMsg = messages[0];

    const turn = await createTurn(getDb(), {
      id: turnId,
      tenantId,
      conversationId: conversation.id,
      subscriberId,
      batchSize: messages.length,
      batchText,
      batchMessageIds: messages.map((m) => m.id),
      triggerSource: subscriber.currentChannel ? undefined : undefined,
      triggerChannel: subscriber.currentChannel ?? undefined,
    });

    await touchUserMsg(getDb(), conversation.id);

    // 6. Dispatch a n8n
    const dispatchPayload: N8nDispatchPayload = {
      schema_version: 'v1',
      turn_id: turn.id,
      callback_url: `${config.PUBLIC_API_URL}/admin/turn-completed`,
      callback_token: config.N8N_CALLBACK_TOKEN,
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        config: tenantConfig,
      },
      subscriber: {
        id: subscriber.id,
        manychat_subscriber_id: subscriber.manychatSubscriberId,
        ig_user_id: subscriber.igUserId,
        ig_username: subscriber.igUsername,
        display_name: subscriber.displayName,
        locale: subscriber.locale,
        metadata: (subscriber.metadata as Record<string, unknown>) ?? {},
      },
      conversation: {
        id: conversation.id,
        opened_at: conversation.openedAt.toISOString(),
      },
      messages: messages.map((m) => ({
        id: m.id,
        external_message_id: m.external_message_id,
        text: m.text,
        reply_type: m.reply_type,
        ts: m.ts,
        media_urls: m.media_urls,
      })),
      trigger: firstMsg
        ? {
            source: subscriber.currentChannel ?? null,
            channel: subscriber.currentChannel ?? null,
          }
        : undefined,
    };

    try {
      const dispatchResult = await dispatchToN8n({
        workflowUrl,
        payload: dispatchPayload,
        log: logger(),
      });
      await markTurnDispatched(getDb(), {
        turnId: turn.id,
        n8nExecutionId: dispatchResult.executionId,
      });
      log.info(
        {
          turn_id: turn.id,
          batch_size: messages.length,
          execution_id: dispatchResult.executionId,
        },
        'turn dispatched',
      );
      return { status: 'dispatched', turn_id: turn.id, batch_size: messages.length };
    } catch (err) {
      // Liberar lock para que un nuevo turn pueda arrancar
      await releaseTurnLock(getRedis(), { tenantId, subscriberId, turnId });
      const errMsg = err instanceof Error ? err.message : String(err);
      await markTurnFailed(getDb(), { turnId: turn.id, error: errMsg });

      const retriable = err instanceof N8nDispatchError ? err.retriable : true;
      log.error({ err, retriable }, 'dispatch to n8n failed');
      if (retriable) {
        throw err; // BullMQ reintenta con backoff
      }
      // 4xx: no reintentar
      return { status: 'skipped', reason: 'non_retriable_failure' };
    }
  } catch (err) {
    // Errores antes del dispatch: liberar lock y propagar
    await releaseTurnLock(getRedis(), { tenantId, subscriberId, turnId });
    throw err;
  }
}
