import winston from 'winston';
import { config } from '../config';

// Custom format for development
const devFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
    return `${timestamp} [${level}]: ${message}${metaStr}`;
  })
);

// JSON format for production
const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create logger instance
export const logger = winston.createLogger({
  level: config.server.logLevel,
  format: config.server.isProduction ? prodFormat : devFormat,
  defaultMeta: { service: 'sunset-api' },
  transports: [
    new winston.transports.Console({
      silent: config.server.isTest,
    }),
  ],
});

// Add file transports in production
if (config.server.isProduction) {
  logger.add(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  );
  logger.add(
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5242880,
      maxFiles: 5,
    })
  );
}

// Helper methods
export const logRequest = (method: string, path: string, meta?: object) => {
  logger.info(`${method} ${path}`, meta);
};

export const logCache = (action: 'hit' | 'miss' | 'set', key: string, meta?: object) => {
  logger.debug(`Cache ${action}: ${key}`, meta);
};
