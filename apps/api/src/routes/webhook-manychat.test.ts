import { describe, expect, it } from 'vitest';
import { matchEscalationTrigger } from './webhook-manychat.js';

const baseMessage = {
  text: '',
  media: [] as { type: 'image' | 'video' | 'audio' | 'file'; url: string }[],
};

describe('matchEscalationTrigger', () => {
  it('detects audio media', () => {
    const result = matchEscalationTrigger(
      { ...baseMessage, media: [{ type: 'audio', url: 'https://cdn/x.mp3' }] },
      undefined,
    );
    expect(result?.kind).toBe('audio');
  });

  it('audio wins over keyword', () => {
    const result = matchEscalationTrigger(
      {
        text: 'eres un bot?',
        media: [{ type: 'audio', url: 'https://cdn/x.mp3' }],
      },
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

  it('ignores non-audio media without keywords', () => {
    const result = matchEscalationTrigger(
      { text: 'mira esta foto', media: [{ type: 'image', url: 'https://cdn/x.jpg' }] },
      ['humano'],
    );
    expect(result).toBeNull();
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
