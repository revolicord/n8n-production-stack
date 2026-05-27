import { type JobsOptions, Queue } from 'bullmq';
import { createRedisConnection } from './redis.js';

export const PROCESS_BATCH_QUEUE = 'process-batch';

export interface ProcessBatchJobData {
  tenantId: string;
  subscriberId: string;
  token: string;
  reason?: 'debounce' | 'hard_limit' | 'post_lock_drain' | 'system_event';
}

export const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 86400 },
};

let cachedQueue: Queue<ProcessBatchJobData> | null = null;

export function getProcessBatchQueue(): Queue<ProcessBatchJobData> {
  if (!cachedQueue) {
    cachedQueue = new Queue<ProcessBatchJobData>(PROCESS_BATCH_QUEUE, {
      connection: createRedisConnection(),
      defaultJobOptions,
    });
  }
  return cachedQueue;
}

export async function closeQueue(): Promise<void> {
  if (cachedQueue) {
    await cachedQueue.close();
    cachedQueue = null;
  }
}
