import { Request, Response } from 'express';
import { cacheService } from '../../cache';
import { ApiResponse } from '../../models/types';

/**
 * Health check endpoint
 * GET /api/health
 */
export const healthCheck = async (_req: Request, res: Response): Promise<void> => {
  const cacheStats = await cacheService.getStats();

  res.json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      cache: cacheStats,
    },
  } as ApiResponse);
};

/**
 * Get cache statistics (admin endpoint)
 * GET /api/health/cache
 */
export const cacheStats = async (_req: Request, res: Response): Promise<void> => {
  const stats = await cacheService.getStats();

  res.json({
    success: true,
    data: stats,
  } as ApiResponse);
};
