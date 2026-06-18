import type { ContentMessage } from '@dm-api/agent';
import type { FollowupWindow } from '@dm-api/shared';
import type { DueLead } from './lead-crons.js';

/** Añade `utm_content=<subscriberId>` a un link para atribuir el booking al lead. */
export function withUtm(base: string | null | undefined, subscriberId: string): string {
  if (!base) return '';
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}utm_content=${subscriberId}`;
}

interface RenderVars {
  name: string;
  callLink: string;
  nurtureVideo: string;
}

/** Variables de interpolación derivadas del lead (placeholders del template). */
export function renderVars(lead: DueLead): RenderVars {
  return {
    name: lead.displayName ?? '',
    callLink: withUtm(lead.callLink, lead.subscriberId),
    nurtureVideo: lead.nurtureVideoUrl ?? '',
  };
}

/** Reemplaza los placeholders `{{name}}`, `{{call_link}}`, `{{nurture_video}}`. */
export function interpolate(tpl: string | null | undefined, vars: RenderVars): string {
  return (tpl ?? '')
    .replace(/\{\{name\}\}/g, vars.name)
    .replace(/\{\{call_link\}\}/g, vars.callLink)
    .replace(/\{\{nurture_video\}\}/g, vars.nurtureVideo);
}

/** Construye los mensajes de un template `type='content'` (texto + imágenes), ordenados. */
export function buildContentMessages(lead: DueLead): ContentMessage[] {
  const vars = renderVars(lead);
  return [...lead.followupMessages]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((m): ContentMessage[] => {
      if (m.messageType === 'image') {
        return m.mediaUrl ? [{ type: 'image', url: m.mediaUrl }] : [];
      }
      const text = interpolate(m.textContent, vars);
      return text.length > 0 ? [{ type: 'text', text }] : [];
    });
}

/**
 * Texto que se persiste en la memoria del agente (`messages_raw`) y en
 * `lead_followup_log.text_sent`. Mantiene el marcador "[SEGUIMIENTO AUTOMÁTICO #N]"
 * del runner n8n para que el agente distinga un follow-up de una respuesta normal.
 */
export function buildMemoryText(lead: DueLead): string {
  const vars = renderVars(lead);
  let body: string;
  if (lead.followupType === 'text') {
    body = interpolate(lead.textTemplate, vars);
  } else if (lead.followupType === 'flow') {
    body = `[flow: ${lead.followupFlowNs ?? ''}] — ${lead.followupDescription ?? ''}`;
  } else {
    // content: marca imágenes y une los textos interpolados.
    const parts = [...lead.followupMessages]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((m) =>
        m.messageType === 'image' ? '[IMAGEN ENVIADA]' : interpolate(m.textContent, vars),
      )
      .filter((p) => p.length > 0);
    body = parts.join(' ');
  }
  return `[SEGUIMIENTO AUTOMÁTICO #${lead.nextSequenceNumber}] ${body}`.trim();
}

// ── Recordatorios de cita ──────────────────────────────────────────────────

/** Formatea la hora de la cita en la zona del lead para los recordatorios. */
export function formatBookingStart(startTime: Date | null, timezone: string | null): string {
  if (!startTime) return 'la fecha acordada';
  return new Intl.DateTimeFormat('es', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone ?? 'America/Santo_Domingo',
  }).format(startTime);
}

/** Interpola los placeholders de un recordatorio de cita. */
export function interpolateBooking(
  tpl: string | null | undefined,
  vars: { name: string; startTime: string; joinUrl: string },
): string {
  return (tpl ?? '')
    .replace(/\{\{name\}\}/g, vars.name)
    .replace(/\{\{start_time\}\}/g, vars.startTime)
    .replace(/\{\{join_url\}\}/g, vars.joinUrl);
}

// ── Quiet hours ──────────────────────────────────────────────────────────

function tzParts(now: Date, timezone: string): { hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return { hour, minute };
}

/**
 * ¿La hora local del tenant cae dentro de la ventana de envío permitida?
 * Sin ventana = 24/7. `end_hour <= start_hour` se trata como ventana vacía.
 */
export function isWithinWindow(window: FollowupWindow | undefined, now: Date): boolean {
  if (!window) return true;
  if (window.end_hour <= window.start_hour) return false;
  const { hour } = tzParts(now, window.timezone);
  return hour >= window.start_hour && hour < window.end_hour;
}

/**
 * Próximo inicio de ventana (top of `start_hour` en la zona del tenant), para
 * posponer un cron que vence fuera de horario. Precisión a nivel de minuto;
 * suficiente para quiet hours (no se busca exactitud de DST al segundo).
 */
export function nextWindowStart(window: FollowupWindow, now: Date): Date {
  const { hour, minute } = tzParts(now, window.timezone);
  let hoursUntil = (window.start_hour - hour + 24) % 24;
  if (hoursUntil === 0) hoursUntil = 24;
  const ms =
    hoursUntil * 3_600_000 - minute * 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds());
  return new Date(now.getTime() + ms);
}
