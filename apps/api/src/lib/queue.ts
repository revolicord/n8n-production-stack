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

// ── Cola de notificaciones de escalado (entrega a Telegram) ──
export const NOTIFY_QUEUE = 'notify';

export interface NotifyJobData {
  notificationId: string;
}

let cachedNotifyQueue: Queue<NotifyJobData> | null = null;

export function getNotifyQueue(): Queue<NotifyJobData> {
  if (!cachedNotifyQueue) {
    cachedNotifyQueue = new Queue<NotifyJobData>(NOTIFY_QUEUE, {
      connection: createRedisConnection(),
      defaultJobOptions,
    });
  }
  return cachedNotifyQueue;
}

// Job repetible que recuerda por Telegram los leads aún pausados.
export const PAUSE_REMINDER_QUEUE = 'pause-reminder';

export async function closeQueue(): Promise<void> {
  if (cachedQueue) {
    await cachedQueue.close();
    cachedQueue = null;
  }
  if (cachedNotifyQueue) {
    await cachedNotifyQueue.close();
    cachedNotifyQueue = null;
  }
}
