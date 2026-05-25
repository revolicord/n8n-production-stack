import { createDb } from '@dm-api/db';
export * from '@dm-api/db';
export { sql } from 'drizzle-orm';

type Db = ReturnType<typeof createDb>;

// Lazy-init: throws only on first query, not at module load time.
// This lets `next build` parse pages without DATABASE_URL present.
let _db: Db | undefined;
function getDb(): Db {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');
    _db = createDb(url);
  }
  return _db;
}

export const db: Db = new Proxy({} as Db, {
  get(_t, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});
