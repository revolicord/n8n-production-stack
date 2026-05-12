import { timingSafeEqual } from 'node:crypto';

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function verifyMcToken(headerValue: unknown, expected: string): boolean {
  return typeof headerValue === 'string' && safeCompare(headerValue, expected);
}

export function verifyBearerToken(headerValue: unknown, expected: string): boolean {
  if (typeof headerValue !== 'string') {
    return false;
  }
  const parts = headerValue.split(/\s+/);
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer') {
    return false;
  }
  const token = parts[1];
  if (!token) return false;
  return safeCompare(token.trim(), expected.trim());
}
