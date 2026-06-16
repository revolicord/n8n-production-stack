import type { DbClient } from '@dm-api/db';
import type { Logger } from '../lib/logger.js';
import { getTenantById, parseTenantConfig } from './tenants.js';

type ResumeFn = (
  conversationId: string,
  opts: {
    tenantId: string;
    subscriberId: string;
    note: string;
    resolvedBy: string;
    notificationId: string;
  },
) => Promise<{ success: boolean; conversationId: string }>;

let resumeFn: ResumeFn | null = null;

async function getResumeFn(): Promise<ResumeFn> {
  if (!resumeFn) {
    const mod = (await import('@dm-api/agent')) as unknown as { resumeConversation: ResumeFn };
    resumeFn = mod.resumeConversation;
  }
  return resumeFn;
}

/**
 * Reanuda el grafo del agente tras resolver/des-pausar un handoff, SÓLO si el
 * tenant corre con `engine='agent'` (ADR-0025 Fase B). Best-effort: cualquier
 * fallo se loguea sin romper la resolución de la notificación.
 */
export async function maybeResumeAgentConversation(
  db: DbClient,
  opts: {
    tenantId: string;
    subscriberId: string;
    conversationId: string | null | undefined;
    note: string;
    resolvedBy: string;
    notificationId: string;
    log: Logger;
  },
): Promise<void> {
  if (!opts.conversationId) return;
  try {
    const tenant = await getTenantById(db, opts.tenantId);
    if (!tenant) return;
    const cfg = parseTenantConfig(tenant.config);
    if ((cfg.engine ?? 'n8n') !== 'agent') return;

    const resume = await getResumeFn();
    await resume(opts.conversationId, {
      tenantId: opts.tenantId,
      subscriberId: opts.subscriberId,
      note: opts.note,
      resolvedBy: opts.resolvedBy,
      notificationId: opts.notificationId,
    });
    opts.log.info({ conversation_id: opts.conversationId }, 'agent conversation resumed');
  } catch (err) {
    opts.log.error({ err, conversation_id: opts.conversationId }, 'agent resume failed');
  }
}
