import { describe, expect, it } from 'vitest';
import {
  buildContentMessages,
  buildMemoryText,
  interpolate,
  interpolateBooking,
  isWithinWindow,
  nextWindowStart,
  renderVars,
  withUtm,
} from './followup-render.js';
import type { DueLead } from './lead-crons.js';

function makeLead(overrides: Partial<DueLead> = {}): DueLead {
  return {
    cronId: 'cron-1',
    tenantId: 'tenant-1',
    subscriberId: 'sub-1',
    conversationId: 'conv-1',
    currentStageId: 'stage-1',
    nextSequenceNumber: 2,
    cronUpdatedAt: new Date(),
    manychatSubscriberId: '12345',
    displayName: 'Ana',
    subscriberStatus: 'active',
    pausedUntil: null,
    tenantConfig: {},
    maxFollowups: 3,
    stageSlug: 'B',
    isTerminal: false,
    callLink: 'https://calendly.com/x',
    nurtureVideoUrl: 'https://video',
    templateId: 'tpl-1',
    followupType: 'text',
    textTemplate: 'Hola {{name}}, agenda en {{call_link}} o mira {{nurture_video}}',
    followupFlowNs: null,
    followupDescription: null,
    nextDelayMinutes: 60,
    followupMessages: [],
    ...overrides,
  };
}

describe('withUtm', () => {
  it('appends utm_content with ? when no query', () => {
    expect(withUtm('https://c.com/x', 'sub-9')).toBe('https://c.com/x?utm_content=sub-9');
  });
  it('appends with & when query exists', () => {
    expect(withUtm('https://c.com/x?a=1', 'sub-9')).toBe('https://c.com/x?a=1&utm_content=sub-9');
  });
  it('returns empty string for null', () => {
    expect(withUtm(null, 'sub-9')).toBe('');
  });
});

describe('interpolate', () => {
  it('replaces all placeholders, call_link gets utm', () => {
    const lead = makeLead();
    const out = interpolate(lead.textTemplate, renderVars(lead));
    expect(out).toBe(
      'Hola Ana, agenda en https://calendly.com/x?utm_content=sub-1 o mira https://video',
    );
  });
  it('empty name when displayName null', () => {
    const lead = makeLead({ displayName: null, textTemplate: 'Hola {{name}}!' });
    expect(interpolate(lead.textTemplate, renderVars(lead))).toBe('Hola !');
  });
});

describe('buildContentMessages', () => {
  it('orders by sortOrder, maps images and interpolates text, drops empty', () => {
    const lead = makeLead({
      followupType: 'content',
      followupMessages: [
        { messageType: 'image', mediaUrl: 'https://img', textContent: null, sortOrder: 1 },
        { messageType: 'text', mediaUrl: null, textContent: 'Hola {{name}}', sortOrder: 0 },
        { messageType: 'text', mediaUrl: null, textContent: '', sortOrder: 2 },
      ],
    });
    expect(buildContentMessages(lead)).toEqual([
      { type: 'text', text: 'Hola Ana' },
      { type: 'image', url: 'https://img' },
    ]);
  });
});

describe('buildMemoryText', () => {
  it('text type prefixes sequence marker', () => {
    expect(buildMemoryText(makeLead())).toContain('[SEGUIMIENTO AUTOMÁTICO #2]');
  });
  it('flow type references the flow', () => {
    const lead = makeLead({
      followupType: 'flow',
      followupFlowNs: 'qc_x',
      followupDescription: 'd',
    });
    expect(buildMemoryText(lead)).toBe('[SEGUIMIENTO AUTOMÁTICO #2] [flow: qc_x] — d');
  });
  it('content marks images', () => {
    const lead = makeLead({
      followupType: 'content',
      followupMessages: [
        { messageType: 'text', mediaUrl: null, textContent: 'hey {{name}}', sortOrder: 0 },
        { messageType: 'image', mediaUrl: 'u', textContent: null, sortOrder: 1 },
      ],
    });
    expect(buildMemoryText(lead)).toBe('[SEGUIMIENTO AUTOMÁTICO #2] hey Ana [IMAGEN ENVIADA]');
  });
});

describe('isWithinWindow', () => {
  // 2026-06-18T17:00:00Z = 13:00 in America/Santo_Domingo (UTC-4)
  const noon = new Date('2026-06-18T17:00:00Z');
  // 2026-06-18T06:00:00Z = 02:00 in America/Santo_Domingo
  const night = new Date('2026-06-18T06:00:00Z');
  const win = { timezone: 'America/Santo_Domingo', start_hour: 8, end_hour: 21 };

  it('no window = always allowed', () => {
    expect(isWithinWindow(undefined, night)).toBe(true);
  });
  it('inside window', () => {
    expect(isWithinWindow(win, noon)).toBe(true);
  });
  it('outside window (night)', () => {
    expect(isWithinWindow(win, night)).toBe(false);
  });
  it('empty window (end <= start)', () => {
    expect(isWithinWindow({ ...win, start_hour: 20, end_hour: 8 }, noon)).toBe(false);
  });
});

describe('nextWindowStart', () => {
  it('schedules to upcoming start_hour in tz', () => {
    const night = new Date('2026-06-18T06:00:00Z'); // 02:00 local, window starts 08:00
    const win = { timezone: 'America/Santo_Domingo', start_hour: 8, end_hour: 21 };
    const next = nextWindowStart(win, night);
    // 08:00 local = 12:00Z same day
    expect(next.toISOString()).toBe('2026-06-18T12:00:00.000Z');
  });
});

describe('interpolateBooking', () => {
  it('replaces booking placeholders', () => {
    const out = interpolateBooking('Hola {{name}}, te espero {{start_time}}: {{join_url}}', {
      name: 'Ana',
      startTime: 'mañana 3pm',
      joinUrl: 'https://meet',
    });
    expect(out).toBe('Hola Ana, te espero mañana 3pm: https://meet');
  });
});
