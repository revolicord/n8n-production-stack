import { timingSafeEqual } from 'node:crypto';

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function verifyMcToken(headerValue: unknown, expected: string): boolean {
  return typeof headerValue === 'string' && safeCompare(headerValue, expected);
}

export function verifyBearerToken(headerValue: unknown, expected: string): boolean {
  if (typeof headerValue !== 'string' || !headerValue.startsWith('Bearer ')) {
    return false;
  }
  return safeCompare(headerValue.slice(7).trim(), expected);
}
