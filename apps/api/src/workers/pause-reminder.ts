import { subscribers, tenants } from '@dm-api/db';
import { eq } from 'drizzle-orm';
import { getConfig } from '../config.js';
import { getDb } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { escapeHtml, sendMessage } from '../lib/telegram.js';
import { parseTenantConfig } from '../services/tenants.js';

export interface PauseReminderResult {
  status: 'sent' | 'skipped';
  pausedLeads: number;
}

/**
 * Job repetible: re-notifica por Telegram los leads que siguen pausados para
 * que el humano no olvide reanudarlos (la pausa manual es indefinida). Agrupa
 * por tenant y usa su chat configurado, con fallback al chat global.
 */
export async function pauseReminderJob(): Promise<PauseReminderResult> {
  const config = getConfig();
  const log = logger().child({ job: 'pause-reminder' });
  const db = getDb();

  const rows = await db
    .select({ subscriber: subscribers, tenantConfig: tenants.config })
    .from(subscribers)
    .innerJoin(tenants, eq(tenants.id, subscribers.tenantId))
    .where(eq(subscribers.status, 'paused'));

  // Solo pausas vigentes: indefinidas (pausedUntil null) o aún no expiradas.
  const now = new Date();
  const stillPaused = rows.filter(
    (r) => !r.subscriber.pausedUntil || r.subscriber.pausedUntil > now,
  );
  if (stillPaused.length === 0) {
    return { status: 'skipped', pausedLeads: 0 };
  }

  const byTenant = new Map<string, typeof stillPaused>();
  for (const row of stillPaused) {
    const list = byTenant.get(row.subscriber.tenantId);
    if (list) list.push(row);
    else byTenant.set(row.subscriber.tenantId, [row]);
  }

  let sentAny = false;
  for (const [tenantId, tenantRows] of byTenant) {
    const firstRow = tenantRows[0];
    if (!firstRow) continue;
    const tenantConfig = parseTenantConfig(firstRow.tenantConfig);
    const chatId = tenantConfig.telegram_chat_id ?? config.TELEGRAM_DEFAULT_CHAT_ID;
    if (!chatId || !config.TELEGRAM_BOT_TOKEN) {
      log.warn({ tenant_id: tenantId }, 'telegram not configured, skipping pause reminder');
      continue;
    }

    const leadLines = tenantRows.map((r) => {
      const s = r.subscriber;
      const name = s.displayName ?? s.igUsername ?? s.id;
      return `• ${escapeHtml(name)}${s.igUsername ? ` (@${escapeHtml(s.igUsername)})` : ''}`;
    });
    const lines = [
      `⏸ <b>Leads pausados</b> (${tenantRows.length}) — el bot no les responde, recuerda reanudarlos:`,
      ...leadLines,
    ];
    if (config.DASHBOARD_PUBLIC_URL) {
      lines.push(`Panel: ${config.DASHBOARD_PUBLIC_URL}/escalaciones`);
    }

    await sendMessage({ chatId, text: lines.join('\n') });
    sentAny = true;
    log.info({ tenant_id: tenantId, paused: tenantRows.length }, 'pause reminder sent');
  }

  return { status: sentAny ? 'sent' : 'skipped', pausedLeads: stillPaused.length };
}
