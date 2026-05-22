import { describe, expect, it } from 'vitest';
import { LoginBodySchema } from './login.js';

describe('LoginBodySchema', () => {
  it('accepts password string', () => {
    expect(LoginBodySchema.safeParse({ password: 'secret123' }).success).toBe(true);
  });

  it('rejects empty password', () => {
    expect(LoginBodySchema.safeParse({ password: '' }).success).toBe(false);
  });

  it('rejects missing password', () => {
    expect(LoginBodySchema.safeParse({}).success).toBe(false);
  });
});
