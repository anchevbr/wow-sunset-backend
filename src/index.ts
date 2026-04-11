import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { logger } from './utils/logger';
import { cacheService } from './cache';
import routes from './api/routes';
import {
  requestLogger,
  errorHandler,
  notFoundHandler,
  corsOptions,
} from './middleware';

class App {
  public app: Express;

  constructor() {
    this.app = express();
    this.initializeMiddleware();
    this.initializeRoutes();
    this.initializeErrorHandling();
  }

  private initializeMiddleware(): void {
    // Security middleware
    this.app.use(helmet());
    this.app.use(cors(corsOptions));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: config.rateLimit.windowMs,
      max: config.rateLimit.max,
      message: {
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests, please try again later',
        },
      },
      standardHeaders: true,
      legacyHeaders: false,
    });
    this.app.use('/api/', limiter);

    // Body parsing
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Request logging
    this.app.use(requestLogger);
  }

  private initializeRoutes(): void {
    // API routes
    this.app.use('/api', routes);

    // Root endpoint
    this.app.get('/', (_req, res) => {
      res.json({
        name: 'WOW Sunset API',
        version: '1.0.0',
        description: 'Sunset quality forecasting and historical analysis',
        endpoints: {
          health: 'GET /api/health',
          cacheStats: 'GET /api/health/cache',
          location: {
            reverse: 'POST /api/location/reverse',
          },
          sunset: {
            forecast: 'POST /api/sunset/forecast',
            historical: 'POST /api/sunset/historical',
            bestHistorical: 'POST /api/sunset/historical/best',
          },
        },
      });
    });
  }

  private initializeErrorHandling(): void {
    // 404 handler
    this.app.use(notFoundHandler);

    // Global error handler
    this.app.use(errorHandler);
  }

  public async start(): Promise<void> {
    try {
      // Connect to Redis
      logger.info('Connecting to Redis...');
      await cacheService.connect();

      // Start server
      const port = config.server.port;
      this.app.listen(port, () => {
        logger.info(`🌅 WOW Sunset API server started`);
        logger.info(`📍 Environment: ${config.server.env}`);
        logger.info(`🚀 Server listening on port ${port}`);
        logger.info(`🔗 Health check: http://localhost:${port}/api/health`);
      });
    } catch (error) {
      logger.error('Failed to start server', error as Error);
      process.exit(1);
    }
  }

  public async shutdown(): Promise<void> {
    logger.info('Shutting down server...');
    await cacheService.disconnect();
    logger.info('Server shutdown complete');
  }
}

// Create and start application
const application = new App();

// Graceful shutdown handlers
process.on('SIGTERM', async () => {
  logger.info('SIGTERM signal received');
  await application.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT signal received');
  await application.shutdown();
  process.exit(0);
});

// Start the server
if (require.main === module) {
  application.start();
}

export default application.app;
