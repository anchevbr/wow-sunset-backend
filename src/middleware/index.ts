import { Request, Response, NextFunction } from 'express';
import { CorsOptions } from 'cors';
import { logger, logRequest } from '../utils/logger';
import { ApiResponse } from '../models/types';
import { config } from '../config';

export * from './access-control';

/**
 * Request logging middleware
 */
export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const start = Date.now();

  // Log after response is sent
  res.on('finish', () => {
    const duration = Date.now() - start;
    logRequest(req.method, req.path, {
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      accessType: req.accessContext?.type,
    });
  });

  next();
};

/**
 * Global error handler middleware
 */
export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const bodyParserError = error as Error & { status?: number; statusCode?: number; type?: string };

  if (bodyParserError.type === 'entity.too.large' || bodyParserError.status === 413) {
    res.status(413).json({
      success: false,
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body too large',
      },
    } as ApiResponse);
    return;
  }

  logger.error('Unhandled error', error, {
    method: req.method,
    path: req.path,
    contentLength: req.get('content-length'),
    contentType: req.get('content-type'),
  });

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    },
  } as ApiResponse);
};

/**
 * 404 handler middleware
 */
export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
  } as ApiResponse);
};

/**
 * CORS options
 */
export const corsOptions: CorsOptions = {
  origin: config.cors.origin,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Internal-App-Secret'],
  credentials: config.cors.origin !== '*',
};
