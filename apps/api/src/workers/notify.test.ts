/**
 * Tests del worker de escalado a humano (notifyJob).
 *
 * Verifica que dado una notificación en DB el worker:
 *   1. Construye el mensaje correcto para Telegram (nombre lead, etapa, motivo)
 *   2. Llama a sendMessage con el chat_id correcto
 *   3. Guarda los IDs de Telegram en la notificación
 *   4. Omite el envío en casos que deben ser skipped
 *
 * Útil para diagnosticar: ¿el problema es el contenido del mensaje,
 * el chat_id configurado, o es que la notificación ya fue resuelta?
 */
import type { Job } from 'bullmq';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks de dependencias ─────────────────────────────────────────────────────

vi.mock('../config.js', () => ({ getConfig: vi.fn() }));
vi.mock('../lib/db.js', () => ({ getDb: vi.fn() }));
vi.mock('../lib/logger.js', () => ({
  logger: vi.fn(() => ({
    child: vi.fn(() => ({
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    })),
  })),
}));
vi.mock('../lib/telegram.js', () => ({
  sendMessage: vi.fn(),
  escapeHtml: (s: string) =>
    s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
}));
vi.mock('../services/notifications.js', () => ({
  getNotificationById: vi.fn(),
  setTelegramRef: vi.fn(),
}));
vi.mock('../services/subscribers.js', () => ({
  getSubscriberByUuid: vi.fn(),
}));
vi.mock('../services/tenants.js', () => ({
  getTenantById: vi.fn(),
  parseTenantConfig: vi.fn(),
}));
vi.mock('../services/lead-stages.js', () => ({
  getLeadStage: vi.fn(),
}));

// ── Imports después de los mocks ──────────────────────────────────────────────

import { getConfig } from '../config.js';
import { getDb } from '../lib/db.js';
import { sendMessage } from '../lib/telegram.js';
import { getLeadStage } from '../services/lead-stages.js';
import { getNotificationById, setTelegramRef } from '../services/notifications.js';
import { getSubscriberByUuid } from '../services/subscribers.js';
import { getTenantById, parseTenantConfig } from '../services/tenants.js';
import { notifyJob, pendingButtons } from '../workers/notify.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

type NotifyJobData = { notificationId: string };

function makeJob(notificationId: string): Job<NotifyJobData> {
  return { id: 'job-test-1', data: { notificationId } } as unknown as Job<NotifyJobData>;
}

const NOTIFICATION_ID = 'notif-uuid-test-1';
const SUBSCRIBER_ID = 'sub-uuid-test-1';
const TENANT_ID = 'tenant-uuid-test-1';
const CHAT_ID = '-1009876543210';

const baseNotification = {
  id: NOTIFICATION_ID,
  tenantId: TENANT_ID,
  subscriberId: SUBSCRIBER_ID,
  kind: 'agent',
  status: 'pending',
  reason: 'El lead preguntó si somos humanos',
  summary: null,
  telegramChatId: null,
  telegramMessageId: null,
  createdAt: new Date('2025-01-01T10:00:00Z'),
};

const baseSubscriber = {
  id: SUBSCRIBER_ID,
  manychatSubscriberId: '111222333',
  displayName: 'Ana Torres',
  igUsername: 'ana_torres_ig',
};

function setupHappyPath() {
  (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
    TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_DEFAULT_CHAT_ID: CHAT_ID,
    DASHBOARD_PUBLIC_URL: 'https://dashboard.example.com',
  });
  (getDb as ReturnType<typeof vi.fn>).mockReturnValue({});
  (getNotificationById as ReturnType<typeof vi.fn>).mockResolvedValue(baseNotification);
  (getSubscriberByUuid as ReturnType<typeof vi.fn>).mockResolvedValue(baseSubscriber);
  (getTenantById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: TENANT_ID, config: {} });
  (parseTenantConfig as ReturnType<typeof vi.fn>).mockReturnValue({});
  (getLeadStage as ReturnType<typeof vi.fn>).mockResolvedValue('Prospecto Calificado');
  (sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
    messageId: '99',
    chatId: CHAT_ID,
  });
  (setTelegramRef as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('notifyJob — happy path', () => {
  beforeEach(setupHappyPath);
  afterEach(() => vi.clearAllMocks());

  it('devuelve status: sent', async () => {
    const result = await notifyJob(makeJob(NOTIFICATION_ID));
    expect(result.status).toBe('sent');
  });

  it('llama a sendMessage con el chat_id correcto', async () => {
    await notifyJob(makeJob(NOTIFICATION_ID));

    expect(sendMessage).toHaveBeenCalledOnce();
    const args = (sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      chatId: string;
      text: string;
      buttons: unknown;
    };
    expect(args.chatId).toBe(CHAT_ID);
  });

  it('el mensaje incluye el nombre del lead y la etapa', async () => {
    await notifyJob(makeJob(NOTIFICATION_ID));

    const args = (sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      text: string;
    };
    expect(args.text).toContain('Ana Torres');
    expect(args.text).toContain('Prospecto Calificado');
  });

  it('el mensaje incluye el motivo del escalado', async () => {
    await notifyJob(makeJob(NOTIFICATION_ID));

    const { text } = (sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      text: string;
    };
    expect(text).toContain('El lead preguntó si somos humanos');
  });

  it('el mensaje incluye el IG del lead', async () => {
    await notifyJob(makeJob(NOTIFICATION_ID));

    const { text } = (sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      text: string;
    };
    expect(text).toContain('@ana_torres_ig');
    expect(text).toContain('instagram.com/ana_torres_ig');
  });

  it('el mensaje incluye deep-link al dashboard', async () => {
    await notifyJob(makeJob(NOTIFICATION_ID));

    const { text } = (sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      text: string;
    };
    expect(text).toContain('dashboard.example.com');
  });

  it('incluye botones pause y resolve', async () => {
    await notifyJob(makeJob(NOTIFICATION_ID));

    const { buttons } = (sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      buttons: Array<Array<{ text: string; callback_data: string }>>;
    };
    const flatButtons = buttons.flat();
    expect(flatButtons.some((b) => b.callback_data.startsWith('pause:'))).toBe(true);
    expect(flatButtons.some((b) => b.callback_data.startsWith('resolve:'))).toBe(true);
  });

  it('guarda los IDs de Telegram en la notificación', async () => {
    await notifyJob(makeJob(NOTIFICATION_ID));

    expect(setTelegramRef).toHaveBeenCalledOnce();
    const args = (setTelegramRef as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      id: string;
      chatId: string;
      messageId: string;
    };
    expect(args.id).toBe(NOTIFICATION_ID);
    expect(args.messageId).toBe('99');
  });

  it('usa telegram_chat_id del tenant si está configurado (override)', async () => {
    const tenantChatId = '-1001111111111';
    (parseTenantConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      telegram_chat_id: tenantChatId,
    });

    await notifyJob(makeJob(NOTIFICATION_ID));

    const { chatId } = (sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      chatId: string;
    };
    expect(chatId).toBe(tenantChatId);
  });
});

describe('notifyJob — cabeceras de kind', () => {
  beforeEach(setupHappyPath);
  afterEach(() => vi.clearAllMocks());

  it.each([
    ['audio', '🎙'],
    ['image', '🖼'],
    ['video', '🎬'],
    ['location', '📍'],
    ['file', '📎'],
    ['unknown', '❓'],
    ['keyword', '🚨'],
    ['agent', '🤖'],
  ])('kind=%s incluye el emoji %s en el mensaje', async (kind, emoji) => {
    (getNotificationById as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseNotification,
      kind,
    });

    await notifyJob(makeJob(NOTIFICATION_ID));

    const { text } = (sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      text: string;
    };
    expect(text).toContain(emoji);
  });
});

describe('notifyJob — casos skipped', () => {
  afterEach(() => vi.clearAllMocks());

  it('skipped cuando la notificación no existe en DB', async () => {
    (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({ TELEGRAM_BOT_TOKEN: 'tk' });
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue({});
    (getNotificationById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await notifyJob(makeJob('notif-inexistente'));

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('not_found');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('skipped cuando la notificación ya está resuelta', async () => {
    (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({ TELEGRAM_BOT_TOKEN: 'tk' });
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue({});
    (getNotificationById as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseNotification,
      status: 'resolved',
    });

    const result = await notifyJob(makeJob(NOTIFICATION_ID));

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('already_resolved');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('skipped cuando el mensaje ya fue enviado a Telegram (idempotencia)', async () => {
    (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({ TELEGRAM_BOT_TOKEN: 'tk' });
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue({});
    (getNotificationById as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseNotification,
      telegramMessageId: '55', // ya tiene ID de mensaje
    });

    const result = await notifyJob(makeJob(NOTIFICATION_ID));

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('already_sent');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('skipped cuando no hay TELEGRAM_BOT_TOKEN configurado', async () => {
    (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_DEFAULT_CHAT_ID: '',
    });
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue({});
    (getNotificationById as ReturnType<typeof vi.fn>).mockResolvedValue(baseNotification);
    (getSubscriberByUuid as ReturnType<typeof vi.fn>).mockResolvedValue(baseSubscriber);
    (getTenantById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: TENANT_ID, config: {} });
    (parseTenantConfig as ReturnType<typeof vi.fn>).mockReturnValue({});

    const result = await notifyJob(makeJob(NOTIFICATION_ID));

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('telegram_not_configured');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('skipped cuando no hay chat_id (ni en tenant ni en env)', async () => {
    (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      TELEGRAM_BOT_TOKEN: 'token-ok',
      TELEGRAM_DEFAULT_CHAT_ID: '', // sin chat por defecto
    });
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue({});
    (getNotificationById as ReturnType<typeof vi.fn>).mockResolvedValue(baseNotification);
    (getSubscriberByUuid as ReturnType<typeof vi.fn>).mockResolvedValue(baseSubscriber);
    (getTenantById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: TENANT_ID, config: {} });
    (parseTenantConfig as ReturnType<typeof vi.fn>).mockReturnValue({}); // sin telegram_chat_id

    const result = await notifyJob(makeJob(NOTIFICATION_ID));

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('telegram_not_configured');
  });

  it('skipped cuando el subscriber no existe en DB', async () => {
    (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      TELEGRAM_BOT_TOKEN: 'token-ok',
      TELEGRAM_DEFAULT_CHAT_ID: CHAT_ID,
    });
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue({});
    (getNotificationById as ReturnType<typeof vi.fn>).mockResolvedValue(baseNotification);
    (getSubscriberByUuid as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await notifyJob(makeJob(NOTIFICATION_ID));

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('subscriber_not_found');
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('pendingButtons', () => {
  it('genera botones con callback_data correcto para pause y resolve', () => {
    const id = 'notif-uuid-abc123';
    const buttons = pendingButtons(id);

    const flat = buttons.flat();
    expect(flat).toHaveLength(2);
    expect(flat[0]?.callback_data).toBe(`pause:${id}`);
    expect(flat[1]?.callback_data).toBe(`resolve:${id}`);
  });

  it('el texto de los botones es legible', () => {
    const buttons = pendingButtons('some-id').flat();
    expect(buttons[0]?.text).toContain('Pausar');
    expect(buttons[1]?.text).toContain('Resuelto');
  });
});
