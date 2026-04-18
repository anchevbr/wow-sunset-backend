import express, { Express } from 'express';
import { Server } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { logger } from './utils/logger';
import { cacheService } from './cache';
import routes from './api/routes';
import {
  attachRequestAccessContext,
  apiAccessGuard,
  requestLogger,
  rateLimitKeyGenerator,
  rateLimitSkip,
  errorHandler,
  notFoundHandler,
  corsOptions,
} from './middleware';

class App {
  public app: Express;
  private server: Server | null = null;
  private isShuttingDown = false;

  constructor() {
    this.app = express();
    this.app.set('trust proxy', config.server.trustProxy);
    this.initializeMiddleware();
    this.initializeRoutes();
    this.initializeErrorHandling();
  }

  private initializeMiddleware(): void {
    // Security middleware
    this.app.use(helmet());
    this.app.use(cors(corsOptions));
    this.app.use(attachRequestAccessContext);

    // Request logging
    this.app.use(requestLogger);

    // Rate limiting
    const limiter = rateLimit({
      windowMs: config.rateLimit.windowMs,
      max: config.rateLimit.max,
      skip: rateLimitSkip,
      keyGenerator: rateLimitKeyGenerator,
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
    this.app.use('/api', apiAccessGuard);

    // Body parsing
    this.app.use(express.json({ limit: config.request.jsonBodyLimit }));
    this.app.use(
      express.urlencoded({
        extended: true,
        limit: config.request.urlEncodedBodyLimit,
        parameterLimit: 20,
      })
    );

  }

  private initializeRoutes(): void {
    // API routes
    this.app.use('/api', routes);

    // Root endpoint
    this.app.get('/', (_req, res) => {
      const endpoints: {
        health: string;
        cacheStats?: string;
        location: {
          reverse: string;
        };
        sunset: {
          forecast: string;
          historical: string;
          bestHistorical: string;
        };
      } = {
        health: 'GET /api/health',
        location: {
          reverse: 'POST /api/location/reverse',
        },
        sunset: {
          forecast: 'POST /api/sunset/forecast',
          historical: 'POST /api/sunset/historical',
          bestHistorical: 'POST /api/sunset/historical/best',
        },
      };

      if (config.health.enableCacheStatsEndpoint) {
        endpoints.cacheStats = 'GET /api/health/cache';
      }

      res.json({
        name: 'WOW Sunset API',
        version: '1.0.0',
        description: 'Sunset quality forecasting and historical analysis',
        endpoints,
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
      if (this.server) {
        return;
      }

      // Connect to Redis
      logger.info('Connecting to Redis...');
      await cacheService.connect();

      // Start server
      const port = config.server.port;
      this.server = this.app.listen(port, () => {
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
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    logger.info('Shutting down server...');

    try {
      await Promise.all([
        this.closeServer(),
        cacheService.disconnect(),
      ]);
    } finally {
      this.isShuttingDown = false;
    }

    logger.info('Server shutdown complete');
  }

  private async closeServer(): Promise<void> {
    if (!this.server) {
      return;
    }

    const activeServer = this.server;
    this.server = null;

    await new Promise<void>((resolve, reject) => {
      activeServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

// Create and start application
const application = new App();

// Graceful shutdown handlers
const registerShutdownHandler = (signal: NodeJS.Signals): void => {
  process.once(signal, async () => {
    logger.info(`${signal} signal received`);

    try {
      await application.shutdown();
      process.exit(0);
    } catch (error) {
      logger.error('Shutdown failed', error as Error, { signal });
      process.exit(1);
    }
  });
};

registerShutdownHandler('SIGTERM');
registerShutdownHandler('SIGINT');

// Start the server
if (require.main === module) {
  application.start();
}

export default application.app;
