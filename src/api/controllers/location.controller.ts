import { Request, Response } from 'express';
import openMeteoService from '../../services/open-meteo.service';
import { logger } from '../../utils/logger';
import { reverseGeocodeRequestSchema } from '../../utils/validators';
import { ApiResponse } from '../../models/types';

/**
 * Reverse geocode coordinates to location
 * POST /api/location/reverse
 */
export const reverseGeocode = async (req: Request, res: Response): Promise<void> => {
  try {
    const validationResult = reverseGeocodeRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request parameters',
          details: validationResult.error.errors,
        },
      } as ApiResponse);
      return;
    }

    const coords = validationResult.data;
    const result = await openMeteoService.reverseGeocode(coords);

    if (!result.success) {
      const statusCode = result.error?.code === 'LOCATION_NOT_FOUND' ? 404 : 500;
      res.status(statusCode).json({
        success: false,
        error: result.error,
      } as ApiResponse);
      return;
    }

    res.json({
      success: true,
      data: result.data,
      meta: {
        timestamp: new Date().toISOString(),
        cached: result.fromCache,
      },
    } as ApiResponse);
  } catch (error) {
    logger.error('Reverse geocode controller error', error as Error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    } as ApiResponse);
  }
};
