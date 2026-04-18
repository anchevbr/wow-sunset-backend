import { Router } from 'express';
import * as healthController from '../controllers/health.controller';
import { config } from '../../config';

const router = Router();

/**
 * GET /api/health
 * Health check endpoint
 */
router.get('/', healthController.healthCheck);

/**
 * GET /api/health/cache
 * Cache statistics
 */
if (config.health.enableCacheStatsEndpoint) {
	router.get('/cache', healthController.cacheStats);
}

export default router;
