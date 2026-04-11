import { Router } from 'express';
import * as healthController from '../controllers/health.controller';

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
router.get('/cache', healthController.cacheStats);

export default router;
