import pino from 'pino';

// Read the level straight from the environment so the logger has no dependency
// on env validation (it can be used even before secrets are checked).
const level = process.env.LOG_LEVEL?.trim() || 'info';
const isProd = process.env.NODE_ENV === 'production';

export const logger = pino(
  isProd
    ? { level }
    : {
        level,
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' }
        }
      }
);
