import { describe, expect, it } from 'vitest';
import { UpdateMessageBodySchema } from './followup-messages.js';

describe('UpdateMessageBodySchema', () => {
  it('accepts empty patch', () => {
    expect(UpdateMessageBodySchema.safeParse({}).success).toBe(true);
  });

  it('accepts partial patch with only sort_order', () => {
    expect(UpdateMessageBodySchema.safeParse({ sort_order: 2 }).success).toBe(true);
  });

  it('accepts null text_content to clear', () => {
    expect(UpdateMessageBodySchema.safeParse({ text_content: null }).success).toBe(true);
  });

  it('rejects invalid message_type', () => {
    expect(UpdateMessageBodySchema.safeParse({ message_type: 'video' }).success).toBe(false);
  });
});
