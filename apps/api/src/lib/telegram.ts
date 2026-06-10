import { getConfig } from '../config.js';
import { logger } from './logger.js';

/**
 * Cliente mínimo de la Bot API de Telegram (sin dependencias nuevas).
 * Si TELEGRAM_BOT_TOKEN no está configurado, todas las llamadas se omiten
 * devolviendo null (log warn) — la notificación queda igualmente en DB.
 */

export interface TelegramInlineButton {
  text: string;
  callback_data: string;
}

export interface TelegramSendResult {
  messageId: string;
  chatId: string;
}

interface TelegramApiResponse {
  ok: boolean;
  description?: string;
  result?: { message_id?: number; chat?: { id?: number } };
}

async function callTelegram(
  method: string,
  body: Record<string, unknown>,
): Promise<TelegramApiResponse | null> {
  const { TELEGRAM_BOT_TOKEN } = getConfig();
  if (!TELEGRAM_BOT_TOKEN) {
    logger().warn({ method }, 'TELEGRAM_BOT_TOKEN not configured, skipping telegram call');
    return null;
  }

  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as TelegramApiResponse;
  if (!data.ok) {
    throw new Error(`telegram ${method} failed (${res.status}): ${data.description ?? 'unknown'}`);
  }
  return data;
}

export async function sendMessage(args: {
  chatId: string;
  text: string;
  buttons?: TelegramInlineButton[][];
}): Promise<TelegramSendResult | null> {
  const data = await callTelegram('sendMessage', {
    chat_id: args.chatId,
    text: args.text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(args.buttons ? { reply_markup: { inline_keyboard: args.buttons } } : {}),
  });
  if (!data?.result?.message_id) return null;
  return {
    messageId: String(data.result.message_id),
    chatId: String(data.result.chat?.id ?? args.chatId),
  };
}

export async function editMessageText(args: {
  chatId: string;
  messageId: string;
  text: string;
  buttons?: TelegramInlineButton[][];
}): Promise<void> {
  await callTelegram('editMessageText', {
    chat_id: args.chatId,
    message_id: Number(args.messageId),
    text: args.text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: args.buttons ?? [] },
  });
}

export async function editMessageReplyMarkup(args: {
  chatId: string;
  messageId: string;
  buttons: TelegramInlineButton[][];
}): Promise<void> {
  await callTelegram('editMessageReplyMarkup', {
    chat_id: args.chatId,
    message_id: Number(args.messageId),
    reply_markup: { inline_keyboard: args.buttons },
  });
}

export async function answerCallbackQuery(args: {
  callbackQueryId: string;
  text?: string;
}): Promise<void> {
  await callTelegram('answerCallbackQuery', {
    callback_query_id: args.callbackQueryId,
    ...(args.text ? { text: args.text } : {}),
  });
}

/** Escapa texto dinámico interpolado en mensajes parse_mode=HTML. */
export function escapeHtml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
