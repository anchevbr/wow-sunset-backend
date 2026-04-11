import { Request, Response } from 'express';
import { sunsetService } from '../../services/sunset.service';
import { logger } from '../../utils/logger';
import {
  bestHistoricalRequestSchema,
  forecastRequestSchema,
  historicalRequestSchema,
} from '../../utils/validators';
import { ApiResponse } from '../../models/types';
import openMeteoService from '../../services/open-meteo.service';
import { scoringService } from '../../services/scoring.service';
import {
  formatDateTimeInTimezone,
  serializeSunsetForecast,
  serializeSunsetScore,
} from '../../utils/timezone';

/**
 * Get sunset forecast for coordinates
 * POST /api/sunset/forecast
 */
export const getForecast = async (req: Request, res: Response): Promise<void> => {
  try {
    // Validate request
    const validationResult = forecastRequestSchema.safeParse(req.body);
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

    // Call service
    const result = await sunsetService.getSunsetForecast(coords);

    if (!result.success) {
      res.status(500).json({
        success: false,
        error: result.error,
      } as ApiResponse);
      return;
    }

    const forecast = result.data;
    if (!forecast) {
      res.status(500).json({
        success: false,
        error: {
          code: 'FORECAST_ERROR',
          message: 'Forecast data is unavailable',
        },
      } as ApiResponse);
      return;
    }

    const timezone = forecast.location.timezone;

    res.json({
      success: true,
      data: serializeSunsetForecast(forecast, timezone),
      meta: {
        timestamp: formatDateTimeInTimezone(new Date(), timezone),
        cached: result.fromCache,
      },
    } as ApiResponse);
  } catch (error) {
    logger.error('Forecast controller error', error as Error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    } as ApiResponse);
  }
};

/**
 * Get historical sunset score for a specific date
 * POST /api/sunset/historical
 */
export const getHistorical = async (req: Request, res: Response): Promise<void> => {
  try {
    // Validate request
    const validationResult = historicalRequestSchema.safeParse(req.body);
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

    const { lat, lng, date } = validationResult.data;
    const coords = { lat, lng };
    const targetDate = new Date(date);

    // Check if date is in the future
    if (targetDate > new Date()) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Cannot get historical data for future dates',
        },
      } as ApiResponse);
      return;
    }

    // Get location info
    const locationResult = await openMeteoService.reverseGeocode(coords);
    if (!locationResult.success || !locationResult.data) {
      res.status(500).json({
        success: false,
        error: {
          code: 'LOCATION_ERROR',
          message: 'Failed to resolve location',
        },
      } as ApiResponse);
      return;
    }

    // Get historical weather data
    const weatherResult = await openMeteoService.getHistorical(coords, targetDate);
    if (!weatherResult.success || !weatherResult.data) {
      res.status(500).json({
        success: false,
        error: weatherResult.error || {
          code: 'HISTORICAL_ERROR',
          message: 'Failed to get historical weather data',
        },
      } as ApiResponse);
      return;
    }

    // Calculate sunset score
    const score = scoringService.calculateScore(
      weatherResult.data.selected,
      coords,
      weatherResult.data.selected.timestamp,
      weatherResult.data.previous,
      weatherResult.data.recentPrecipitation ?? 0
    );

    res.json({
      success: true,
      data: {
        location: locationResult.data,
        ...serializeSunsetScore(score, locationResult.data.timezone),
      },
      meta: {
        timestamp: formatDateTimeInTimezone(new Date(), locationResult.data.timezone),
      },
    } as ApiResponse);
  } catch (error) {
    logger.error('Historical sunset controller error', error as Error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    } as ApiResponse);
  }
};

/**
 * Get best sunset days for the current calendar year
 * POST /api/sunset/historical/best
 */
export const getBestHistorical = async (req: Request, res: Response): Promise<void> => {
  try {
    const validationResult = bestHistoricalRequestSchema.safeParse(req.body);
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

    const { lat, lng, limit } = validationResult.data;
    const result = await sunsetService.getBestHistoricalSunsets({ lat, lng }, limit);

    if (!result.success || !result.data) {
      res.status(500).json({
        success: false,
        error: result.error || {
          code: 'BEST_HISTORICAL_ERROR',
          message: 'Failed to determine best historical sunsets',
        },
      } as ApiResponse);
      return;
    }

    const timezone = result.data.location.timezone;

    res.json({
      success: true,
      data: {
        location: result.data.location,
        bestDays: result.data.bestDays.map((score) => serializeSunsetScore(score, timezone)),
        totalDaysAnalyzed: result.data.totalDaysAnalyzed,
      },
      meta: {
        timestamp: formatDateTimeInTimezone(new Date(), timezone),
      },
    } as ApiResponse);
  } catch (error) {
    logger.error('Best historical sunsets controller error', error as Error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    } as ApiResponse);
  }
};
