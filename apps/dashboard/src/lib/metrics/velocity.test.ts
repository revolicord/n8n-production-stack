import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    execute: vi.fn(),
  },
}));

import { db } from '@/lib/db';
import { getVelocity } from './velocity';

const mockExecute = vi.mocked((db as unknown as { execute: ReturnType<typeof vi.fn> }).execute);

function makeRow(avg: number | null) {
  return [{ avg }];
}

describe('getVelocity', () => {
  const args = {
    tenantId: 'tenant-1',
    start: new Date('2026-01-01'),
    end: new Date('2026-02-01'),
  };

  it('returns all velocity values when all queries return data', async () => {
    mockExecute
      .mockResolvedValueOnce(makeRow(1.5)) // aToMs
      .mockResolvedValueOnce(makeRow(2.0)) // msToB
      .mockResolvedValueOnce(makeRow(0.8)) // bToC
      .mockResolvedValueOnce(makeRow(0.5)); // cToD

    const result = await getVelocity(args);
    expect(result.aToMs).toBeCloseTo(1.5);
    expect(result.msToB).toBeCloseTo(2.0);
    expect(result.bToC).toBeCloseTo(0.8);
    expect(result.cToD).toBeCloseTo(0.5);
    expect(result.aToD).toBeCloseTo(4.8);
  });

  it('returns null for aToD when any segment is null', async () => {
    mockExecute
      .mockResolvedValueOnce(makeRow(1.5)) // aToMs
      .mockResolvedValueOnce(makeRow(null)) // msToB — null
      .mockResolvedValueOnce(makeRow(0.8)) // bToC
      .mockResolvedValueOnce(makeRow(0.5)); // cToD

    const result = await getVelocity(args);
    expect(result.msToB).toBeNull();
    expect(result.aToD).toBeNull();
  });

  it('returns all nulls when no data', async () => {
    mockExecute
      .mockResolvedValueOnce(makeRow(null))
      .mockResolvedValueOnce(makeRow(null))
      .mockResolvedValueOnce(makeRow(null))
      .mockResolvedValueOnce(makeRow(null));

    const result = await getVelocity(args);
    expect(result.aToMs).toBeNull();
    expect(result.aToD).toBeNull();
  });
});
