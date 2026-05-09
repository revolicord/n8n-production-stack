import { type DbClient, createDb } from '@dm-api/db';
import { getConfig } from '../config.js';

let cachedDb: DbClient | null = null;

export function getDb(): DbClient {
  if (!cachedDb) {
    cachedDb = createDb(getConfig().DATABASE_URL);
  }
  return cachedDb;
}
