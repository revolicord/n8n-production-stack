import { type Logger, pino, stdTimeFunctions } from 'pino';
import { getConfig } from '../config.js';

let cachedLogger: Logger | null = null;

export function createLogger(opts: { service: string }): Logger {
  const config = getConfig();
  return pino({
    level: config.LOG_LEVEL,
    base: { service: opts.service, env: config.NODE_ENV },
    redact: {
      paths: ['req.headers.authorization', 'req.headers["x-mc-token"]', 'payload.message.text'],
      remove: false,
    },
    timestamp: stdTimeFunctions.isoTime,
    formatters: {
      level: (label: string) => ({ level: label }),
    },
  });
}

export function logger(): Logger {
  if (!cachedLogger) {
    cachedLogger = createLogger({ service: 'dm-api' });
  }
  return cachedLogger;
}

export type { Logger };
