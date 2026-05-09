import { Worker } from 'bullmq';
import { getConfig } from './config.js';
import { logger } from './lib/logger.js';
import { PROCESS_BATCH_QUEUE, type ProcessBatchJobData } from './lib/queue.js';
import { closeRedis, createRedisConnection } from './lib/redis.js';
import { processBatchJob } from './workers/process-batch.js';

async function main() {
  const config = getConfig();
  const log = logger();

  const worker = new Worker<ProcessBatchJobData>(PROCESS_BATCH_QUEUE, processBatchJob, {
    connection: createRedisConnection(),
    concurrency: config.WORKER_CONCURRENCY,
    autorun: true,
  });

  worker.on('completed', (job, result) => {
    log.info({ job_id: job.id, result }, 'job completed');
  });
  worker.on('failed', (job, err) => {
    log.error({ job_id: job?.id, err }, 'job failed');
  });
  worker.on('error', (err) => {
    log.error({ err }, 'worker error');
  });

  log.info(
    { queue: PROCESS_BATCH_QUEUE, concurrency: config.WORKER_CONCURRENCY },
    'worker started',
  );

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'worker shutting down');
    try {
      await worker.close();
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
