import type { MediaPolicy } from '@dm-api/shared';
import { classifyMessageContent } from '@dm-api/shared';
import { describe, expect, it } from 'vitest';
import { matchEscalationTrigger } from './webhook-manychat.js';

const baseMessage = {
  text: '',
  media: [] as { type: string; url: string }[],
};

describe('matchEscalationTrigger — clases que escalan (allowlist por defecto)', () => {
  it('detects audio media', () => {
    const result = matchEscalationTrigger(
      { ...baseMessage, media: [{ type: 'audio', url: 'https://cdn/x.mp3' }] },
      undefined,
    );
    expect(result?.kind).toBe('audio');
  });

  it('escala imagen aunque traiga caption', () => {
    const result = matchEscalationTrigger(
      { text: 'mira esta foto', media: [{ type: 'image', url: 'https://cdn/x.jpg' }] },
      ['humano'],
    );
    expect(result?.kind).toBe('image');
  });

  it('escala video, ubicación y archivo', () => {
    expect(
      matchEscalationTrigger(
        { ...baseMessage, media: [{ type: 'video', url: 'https://cdn/x.mp4' }] },
        undefined,
      )?.kind,
    ).toBe('video');
    expect(
      matchEscalationTrigger(
        { ...baseMessage, media: [{ type: 'location', url: 'https://maps/x' }] },
        undefined,
      )?.kind,
    ).toBe('location');
    expect(
      matchEscalationTrigger(
        { ...baseMessage, media: [{ type: 'file', url: 'https://cdn/x.pdf' }] },
        undefined,
      )?.kind,
    ).toBe('file');
  });

  it('escala tipos desconocidos (fail-safe → unknown)', () => {
    const result = matchEscalationTrigger(
      { ...baseMessage, media: [{ type: 'mystery_type', url: 'https://cdn/x' }] },
      undefined,
    );
    expect(result?.kind).toBe('unknown');
  });
});

describe('matchEscalationTrigger — clases que NO escalan', () => {
  it('no escala sticker/GIF', () => {
    expect(
      matchEscalationTrigger(
        { ...baseMessage, media: [{ type: 'sticker', url: 'https://cdn/x' }] },
        undefined,
      ),
    ).toBeNull();
    expect(
      matchEscalationTrigger(
        { ...baseMessage, media: [{ type: 'gif', url: 'https://cdn/x' }] },
        undefined,
      ),
    ).toBeNull();
  });

  it('no escala share / respuesta a historia', () => {
    expect(
      matchEscalationTrigger(
        { ...baseMessage, media: [{ type: 'story_reply', url: 'https://cdn/x' }] },
        undefined,
      ),
    ).toBeNull();
  });
});

describe('matchEscalationTrigger — keywords sobre texto', () => {
  it('audio gana sobre keyword', () => {
    const result = matchEscalationTrigger(
      { text: 'eres un bot?', media: [{ type: 'audio', url: 'https://cdn/x.mp3' }] },
      ['bot'],
    );
    expect(result?.kind).toBe('audio');
  });

  it('matches keywords case-insensitive by substring', () => {
    const result = matchEscalationTrigger(
      { ...baseMessage, text: '¿Eres un ROBOT o una persona real?' },
      ['robot', 'humano'],
    );
    expect(result?.kind).toBe('keyword');
    expect(result?.reason).toContain('robot');
  });

  it('returns null without keywords configured', () => {
    expect(
      matchEscalationTrigger({ ...baseMessage, text: 'quiero un humano' }, undefined),
    ).toBeNull();
    expect(matchEscalationTrigger({ ...baseMessage, text: 'quiero un humano' }, [])).toBeNull();
  });

  it('ignores empty/whitespace keywords', () => {
    expect(matchEscalationTrigger({ ...baseMessage, text: 'hola' }, [' ', ''])).toBeNull();
  });
});

describe('matchEscalationTrigger — override de media_policy por tenant', () => {
  it('un override puede desactivar el escalado de audio (agent)', () => {
    const policy: MediaPolicy = { audio: 'agent' };
    const result = matchEscalationTrigger(
      { ...baseMessage, media: [{ type: 'audio', url: 'https://cdn/x.mp3' }] },
      undefined,
      policy,
    );
    expect(result).toBeNull();
  });

  it('un override puede activar el escalado de sticker (escalate)', () => {
    const policy: MediaPolicy = { sticker: 'escalate' };
    const result = matchEscalationTrigger(
      { ...baseMessage, media: [{ type: 'sticker', url: 'https://cdn/x' }] },
      undefined,
      policy,
    );
    expect(result?.kind).toBe('sticker');
  });
});

const AUDIO_CDN_URL =
  'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=848893771274926&signature=Ab102U4gh';

describe('classifyMessageContent — URL de CDN de Instagram en text[]', () => {
  it('URL del CDN de IG en text → unknown', () => {
    expect(classifyMessageContent({ text: AUDIO_CDN_URL, media: [] })).toBe('unknown');
  });

  it('URL del CDN con espacios → text (no es bare URL)', () => {
    expect(classifyMessageContent({ text: `mira ${AUDIO_CDN_URL}`, media: [] })).toBe('text');
  });

  it('texto normal → text', () => {
    expect(classifyMessageContent({ text: 'hola', media: [] })).toBe('text');
  });

  it('media[] tiene prioridad cuando text está vacío', () => {
    expect(classifyMessageContent({ text: '', media: [{ type: 'audio' }] })).toBe('audio');
  });
});

describe('matchEscalationTrigger — URL de CDN de Instagram en text[]', () => {
  it('escala voice note enviada como URL en text[]', () => {
    const result = matchEscalationTrigger({ text: AUDIO_CDN_URL, media: [] }, undefined);
    expect(result?.kind).toBe('unknown');
    expect(result?.reason).toBeTruthy();
  });

  it('no escala URL de CDN cuando media_policy lo desactiva', () => {
    const policy: MediaPolicy = { unknown: 'annotate' };
    const result = matchEscalationTrigger({ text: AUDIO_CDN_URL, media: [] }, undefined, policy);
    expect(result).toBeNull();
  });

  it('keywords no hacen match sobre URL del CDN (no es texto legible)', () => {
    const result = matchEscalationTrigger({ text: AUDIO_CDN_URL, media: [] }, ['fbsbx']);
    // Escala por ser CDN URL, no por keyword (kind=unknown, no keyword)
    expect(result?.kind).toBe('unknown');
    expect(result?.kind).not.toBe('keyword');
  });
});
