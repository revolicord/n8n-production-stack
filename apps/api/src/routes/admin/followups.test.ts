import { describe, expect, it } from 'vitest';
import { CreateFollowupBodySchema, UpdateFollowupBodySchema } from './followups.js';

describe('CreateFollowupBodySchema', () => {
  it('accepts type:text with text_template', () => {
    const result = CreateFollowupBodySchema.safeParse({
      sequence_number: 1,
      delay_minutes: 1440,
      type: 'text',
      text_template: 'Oye {{name}}, ¿viste el video?',
    });
    expect(result.success).toBe(true);
  });

  it('accepts type:flow with flow_ns', () => {
    const result = CreateFollowupBodySchema.safeParse({
      sequence_number: 2,
      delay_minutes: 2880,
      type: 'flow',
      flow_ns: 'QC_video_intro',
    });
    expect(result.success).toBe(true);
  });

  it('rejects type:text without text_template', () => {
    const result = CreateFollowupBodySchema.safeParse({
      sequence_number: 1,
      delay_minutes: 1440,
      type: 'text',
    });
    expect(result.success).toBe(false);
  });

  it('rejects type:flow without flow_ns', () => {
    const result = CreateFollowupBodySchema.safeParse({
      sequence_number: 1,
      delay_minutes: 1440,
      type: 'flow',
    });
    expect(result.success).toBe(false);
  });

  it('rejects sequence_number: 0', () => {
    const result = CreateFollowupBodySchema.safeParse({
      sequence_number: 0,
      delay_minutes: 1440,
      type: 'text',
      text_template: 'x',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative delay_minutes', () => {
    const result = CreateFollowupBodySchema.safeParse({
      sequence_number: 1,
      delay_minutes: -1,
      type: 'text',
      text_template: 'x',
    });
    expect(result.success).toBe(false);
  });

  it('accepts delay_minutes: 15', () => {
    const result = CreateFollowupBodySchema.safeParse({
      sequence_number: 1,
      delay_minutes: 15,
      type: 'text',
      text_template: 'x',
    });
    expect(result.success).toBe(true);
  });

  it('accepts delay_minutes: 1440', () => {
    const result = CreateFollowupBodySchema.safeParse({
      sequence_number: 1,
      delay_minutes: 1440,
      type: 'text',
      text_template: 'x',
    });
    expect(result.success).toBe(true);
  });
});

describe('UpdateFollowupBodySchema', () => {
  it('accepts empty patch', () => {
    expect(UpdateFollowupBodySchema.safeParse({}).success).toBe(true);
  });

  it('accepts partial patch with only delay_minutes', () => {
    expect(UpdateFollowupBodySchema.safeParse({ delay_minutes: 2160 }).success).toBe(true);
  });

  it('accepts null text_template to clear', () => {
    expect(UpdateFollowupBodySchema.safeParse({ text_template: null }).success).toBe(true);
  });
});
