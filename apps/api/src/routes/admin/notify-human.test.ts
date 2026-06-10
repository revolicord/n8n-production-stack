import { describe, expect, it } from 'vitest';
import { NotifyHumanBodySchema } from './notify-human.js';

describe('NotifyHumanBodySchema', () => {
  it('accepts reason only', () => {
    const result = NotifyHumanBodySchema.safeParse({ reason: 'lead pide hablar con humano' });
    expect(result.success).toBe(true);
  });

  it('accepts reason + summary + ids', () => {
    const result = NotifyHumanBodySchema.safeParse({
      reason: 'agresividad',
      summary: 'el lead se molestó por el precio',
      turn_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      conversation_id: '7c9e6679-7425-40de-944b-e07fc1f90ae8',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty reason', () => {
    expect(NotifyHumanBodySchema.safeParse({ reason: '' }).success).toBe(false);
    expect(NotifyHumanBodySchema.safeParse({}).success).toBe(false);
  });

  it('rejects non-uuid turn_id', () => {
    const result = NotifyHumanBodySchema.safeParse({ reason: 'x', turn_id: 'abc' });
    expect(result.success).toBe(false);
  });
});
