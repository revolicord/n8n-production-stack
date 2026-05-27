import { describe, expect, it } from 'vitest';
import { SystemEventBodySchema } from './system-event.js';

describe('SystemEventBodySchema', () => {
  it('accepts a valid booking_confirmed event', () => {
    const result = SystemEventBodySchema.safeParse({
      event_type: 'booking_confirmed',
      detail: 'agendó la llamada para el martes 29 a las 10:00',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty event_type', () => {
    const result = SystemEventBodySchema.safeParse({
      event_type: '',
      detail: 'algo',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty detail', () => {
    const result = SystemEventBodySchema.safeParse({
      event_type: 'booking_confirmed',
      detail: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing fields', () => {
    expect(SystemEventBodySchema.safeParse({ event_type: 'booking_confirmed' }).success).toBe(
      false,
    );
    expect(SystemEventBodySchema.safeParse({ detail: 'algo' }).success).toBe(false);
    expect(SystemEventBodySchema.safeParse({}).success).toBe(false);
  });

  it('rejects non-string types', () => {
    const result = SystemEventBodySchema.safeParse({
      event_type: 123,
      detail: true,
    });
    expect(result.success).toBe(false);
  });
});
