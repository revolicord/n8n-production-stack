import { Queue, Worker } from 'bullmq';
import { getConfig } from './config.js';
import { logger } from './lib/logger.js';
import {
  FOLLOWUP_QUEUE,
  NOTIFY_QUEUE,
  type NotifyJobData,
  PAUSE_REMINDER_QUEUE,
  PROCESS_BATCH_QUEUE,
  type ProcessBatchJobData,
} from './lib/queue.js';
import { closeRedis, createRedisConnection } from './lib/redis.js';
import { followupRunnerJob } from './workers/followup-runner.js';
import { notifyJob } from './workers/notify.js';
import { pauseReminderJob } from './workers/pause-reminder.js';
import { processBatchJob } from './workers/process-batch.js';

async function main() {
  const config = getConfig();
  const log = logger();

  const worker = new Worker<ProcessBatchJobData>(PROCESS_BATCH_QUEUE, processBatchJob, {
    connection: createRedisConnection(),
    concurrency: config.WORKER_CONCURRENCY,
    autorun: true,
  });

  // Entrega de escalaciones a Telegram (baja concurrencia: es una alerta de ops).
  const notifyWorker = new Worker<NotifyJobData>(NOTIFY_QUEUE, notifyJob, {
    connection: createRedisConnection(),
    concurrency: 3,
    autorun: true,
  });

  // Recordatorio repetible de leads pausados. El scheduler se (re)declara en
  // cada arranque; con PAUSE_REMINDER_HOURS=0 se elimina.
  const pauseReminderQueue = new Queue(PAUSE_REMINDER_QUEUE, {
    connection: createRedisConnection(),
  });
  if (config.PAUSE_REMINDER_HOURS > 0) {
    await pauseReminderQueue.upsertJobScheduler('pause-reminder', {
      every: config.PAUSE_REMINDER_HOURS * 3_600_000,
    });
  } else {
    await pauseReminderQueue.removeJobScheduler('pause-reminder');
  }
  const pauseReminderWorker = new Worker(PAUSE_REMINDER_QUEUE, pauseReminderJob, {
    connection: createRedisConnection(),
    concurrency: 1,
    autorun: true,
  });

  // Runner de follow-ups (migración del workflow n8n). El scheduler se (re)declara en
  // cada arranque; con FOLLOWUP_INTERVAL_MINUTES=0 se elimina. El job scheduler de BullMQ
  // dispara una sola vez por tick a nivel de cluster aunque escalen réplicas del worker.
  const followupQueue = new Queue(FOLLOWUP_QUEUE, {
    connection: createRedisConnection(),
  });
  if (config.FOLLOWUP_INTERVAL_MINUTES > 0) {
    await followupQueue.upsertJobScheduler('followup-runner', {
      every: config.FOLLOWUP_INTERVAL_MINUTES * 60_000,
    });
  } else {
    await followupQueue.removeJobScheduler('followup-runner');
  }
  const followupWorker = new Worker(FOLLOWUP_QUEUE, followupRunnerJob, {
    connection: createRedisConnection(),
    concurrency: 1,
    autorun: true,
  });

  for (const [name, w] of [
    [PROCESS_BATCH_QUEUE, worker],
    [NOTIFY_QUEUE, notifyWorker],
    [PAUSE_REMINDER_QUEUE, pauseReminderWorker],
    [FOLLOWUP_QUEUE, followupWorker],
  ] as const) {
    w.on('completed', (job, result) => {
      log.info({ queue: name, job_id: job.id, result }, 'job completed');
    });
    w.on('failed', (job, err) => {
      log.error({ queue: name, job_id: job?.id, err }, 'job failed');
    });
    w.on('error', (err) => {
      log.error({ queue: name, err }, 'worker error');
    });
  }

  log.info(
    {
      queues: [PROCESS_BATCH_QUEUE, NOTIFY_QUEUE, PAUSE_REMINDER_QUEUE, FOLLOWUP_QUEUE],
      concurrency: config.WORKER_CONCURRENCY,
      pause_reminder_hours: config.PAUSE_REMINDER_HOURS,
      followup_interval_minutes: config.FOLLOWUP_INTERVAL_MINUTES,
    },
    'worker started',
  );

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'worker shutting down');
    try {
      await worker.close();
      await notifyWorker.close();
      await pauseReminderWorker.close();
      await pauseReminderQueue.close();
      await followupWorker.close();
      await followupQueue.close();
      await closeRedis();
      process.exit(0);
    } catch (err) {
      log.error({ err }, 'worker shutdown failed');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('worker boot failed', err);
  process.exit(1);
});
