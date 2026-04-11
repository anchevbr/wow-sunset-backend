import { logger } from '../utils/logger';
import { cacheService } from '../cache';
import openMeteoService from './open-meteo.service';
import { scoringService } from './scoring.service';
import {
  Coordinates,
  SunsetForecast,
  SunsetScore,
  ServiceResult,
  WeatherConditions,
} from '../models/types';
import { generateLocationId } from '../utils/helpers';
import { getDateStringInTimezone, getYearInTimezone } from '../utils/timezone';

interface CachedHistoricalYear {
  lastCachedDate: string | null;
  scores: Array<Omit<SunsetScore, 'date' | 'sunsetTime'> & {
    date: string;
    sunsetTime: string;
  }>;
}

class SunsetService {
  /**
   * Get complete sunset forecast for a location
   * Includes 5-day forecast + historical YTD data
   */
  async getSunsetForecast(coords: Coordinates): Promise<ServiceResult<SunsetForecast>> {
    try {
      // Step 1: Resolve location
      const locationResult = await openMeteoService.reverseGeocode(coords);
      if (!locationResult.success || !locationResult.data) {
        return {
          success: false,
          error: locationResult.error || { message: 'Failed to resolve location', code: 'LOCATION_ERROR' },
        };
      }

      const location = locationResult.data;
      const locationId = generateLocationId(location.normalizedCoordinates);

      // Step 2: Check cache first
      const cached = await cacheService.get<SunsetForecast>('forecast', locationId);
      if (cached) {
        logger.info('✅ Cache HIT - returning cached forecast', { locationId });
        return { success: true, data: cached, fromCache: true };
      }

      logger.info('❌ Cache MISS - fetching from Open-Meteo API', { locationId });

      // Step 3: Check for in-flight request (deduplication)
      const lockKey = `forecast:${locationId}`;
      const hasLock = await cacheService.acquireLock(lockKey);

      if (!hasLock) {
        // Another request is in progress, wait for it
        logger.info('Request deduplication - waiting for in-flight request', { locationId });
        await cacheService.waitForLock(lockKey, 10000);
        
        // Try to get the cached result
        const retryResult = await cacheService.get<SunsetForecast>('forecast', locationId);
        if (retryResult) {
          logger.info('✅ Cache HIT after waiting - returning cached forecast', { locationId });
          return { success: true, data: retryResult, fromCache: true };
        }
      }

      try {
        // Step 3: Get weather forecast for next 5 days
        const forecastResult = await openMeteoService.getForecast(location.normalizedCoordinates);
        if (!forecastResult.success || !forecastResult.data) {
          return {
            success: false,
            error: forecastResult.error || { message: 'Failed to get weather forecast', code: 'FORECAST_ERROR' },
          };
        }

        const weatherForecasts = forecastResult.data;

        // Step 4: Calculate sunset scores for forecast
        const forecastScores = this.calculateForecastScores(
          location.normalizedCoordinates,
          weatherForecasts
        );

        // Step 5: Get historical data for current year
        const historicalScores = await this.getHistoricalScores(
          location.normalizedCoordinates,
          location.timezone
        );

        // Step 6: Build response
        const sunsetForecast: SunsetForecast = {
          location,
          forecasts: forecastScores,
          historical: historicalScores,
          generatedAt: new Date(),
          cacheKey: locationId,
        };

        // Cache the complete forecast
        await cacheService.set('forecast', locationId, sunsetForecast);

        logger.info('Generated sunset forecast', {
          location: location.name,
          forecastDays: forecastScores.length,
          historicalDays: historicalScores.length,
        });

        return { success: true, data: sunsetForecast, fromCache: false };
      } finally {
        // Release lock
        await cacheService.releaseLock(lockKey);
      }
    } catch (error) {
      logger.error('Sunset forecast error', error as Error);
      return {
        success: false,
        error: {
          message: 'Failed to generate sunset forecast',
          code: 'FORECAST_GENERATION_ERROR',
          originalError: error as Error,
        },
      };
    }
  }

  /**
   * Calculate sunset scores for weather forecasts
   */
  private calculateForecastScores(
    coords: Coordinates,
    weatherConditions: WeatherConditions[]
  ): SunsetScore[] {
    const scores: SunsetScore[] = [];

    for (let i = 0; i < weatherConditions.length; i++) {
      const currentConditions = weatherConditions[i];
      const previousConditions = i > 0 ? weatherConditions[i - 1] : undefined;

      const score = scoringService.calculateScore(
        currentConditions,
        coords,
        currentConditions.timestamp,
        previousConditions,
        previousConditions?.precipitation ?? 0
      );

      scores.push(score);
    }

    return scores;
  }

  /**
   * Get historical sunset scores for current year (Jan 1 to today)
   */
  private async getHistoricalScores(coords: Coordinates, timeZone: string): Promise<SunsetScore[]> {
    const now = new Date();
    const currentYear = getYearInTimezone(now, timeZone);
    const cacheKey = `${generateLocationId(coords)}:ytd:${currentYear}`;
    const cached = await cacheService.get<CachedHistoricalYear | CachedHistoricalYear['scores']>('historical', cacheKey);
    const cachedYear = this.normalizeCachedHistoricalYear(cached, timeZone);
    const scores = cachedYear.scores.map((score) => this.hydrateSunsetScore(score));
    const todayDateString = getDateStringInTimezone(now, timeZone);
    const datesToFetch = this.buildMissingDateStrings(
      cachedYear.lastCachedDate,
      `${currentYear}-01-01`,
      todayDateString
    );

    if (datesToFetch.length === 0) {
      logger.info('✅ Cache HIT - historical YTD already up to date', { cacheKey, days: scores.length });
      return scores;
    }

    logger.info('🔄 Extending cached historical YTD scores', {
      cacheKey,
      missingDays: datesToFetch.length,
      from: datesToFetch[0],
      to: datesToFetch[datesToFetch.length - 1],
    });

    for (const dateString of datesToFetch) {
      try {
        const result = await openMeteoService.getHistorical(coords, new Date(`${dateString}T12:00:00Z`));
        
        if (result.success && result.data) {
          const score = scoringService.calculateScore(
            result.data.selected,
            coords,
            result.data.selected.timestamp,
            result.data.previous,
            result.data.recentPrecipitation ?? 0
          );
          scores.push(score);
        }
      } catch (error) {
        logger.debug('Historical data fetch failed', { date: dateString });
        // Continue with other dates
      }
    }

    scores.sort((left, right) => left.date.getTime() - right.date.getTime());

    if (scores.length === 0) {
      logger.info('No historical data available for the requested period');
      return scores;
    }

    await cacheService.setPersistent(
      'historical',
      cacheKey,
      {
        lastCachedDate: this.getLastCachedDate(scores, timeZone),
        scores: scores.map((score) => this.serializeCachedSunsetScore(score)),
      } satisfies CachedHistoricalYear
    );

    return scores;
  }

  async getBestHistoricalSunsets(
    coords: Coordinates,
    limit = 5
  ): Promise<ServiceResult<{ location: SunsetForecast['location']; bestDays: SunsetScore[]; totalDaysAnalyzed: number }>> {
    try {
      const locationResult = await openMeteoService.reverseGeocode(coords);
      if (!locationResult.success || !locationResult.data) {
        return {
          success: false,
          error: locationResult.error || { message: 'Failed to resolve location', code: 'LOCATION_ERROR' },
        };
      }

      const bestLimit = Math.min(5, Math.max(1, limit));
      const historicalScores = await this.getHistoricalScores(
        locationResult.data.normalizedCoordinates,
        locationResult.data.timezone
      );
      const bestDays = [...historicalScores]
        .sort((left, right) => right.score - left.score || left.date.getTime() - right.date.getTime())
        .slice(0, bestLimit);

      return {
        success: true,
        data: {
          location: locationResult.data,
          bestDays,
          totalDaysAnalyzed: historicalScores.length,
        },
      };
    } catch (error) {
      logger.error('Best historical sunsets error', error as Error);
      return {
        success: false,
        error: {
          message: 'Failed to determine best historical sunsets',
          code: 'BEST_HISTORICAL_ERROR',
          originalError: error as Error,
        },
      };
    }
  }

  private hydrateSunsetScore(
    score: Omit<SunsetScore, 'date' | 'sunsetTime'> & { date: string; sunsetTime: string }
  ): SunsetScore {
    return {
      ...score,
      date: new Date(score.date),
      sunsetTime: new Date(score.sunsetTime),
    };
  }

  private serializeCachedSunsetScore(
    score: SunsetScore
  ): Omit<SunsetScore, 'date' | 'sunsetTime'> & { date: string; sunsetTime: string } {
    return {
      ...score,
      date: score.date.toISOString(),
      sunsetTime: score.sunsetTime.toISOString(),
    };
  }

  private normalizeCachedHistoricalYear(
    cached: CachedHistoricalYear | CachedHistoricalYear['scores'] | null,
    timeZone: string
  ): CachedHistoricalYear {
    if (!cached) {
      return { lastCachedDate: null, scores: [] };
    }

    if (Array.isArray(cached)) {
      return {
        lastCachedDate: cached.length > 0 ? getDateStringInTimezone(cached[cached.length - 1].date, timeZone) : null,
        scores: cached,
      };
    }

    return cached;
  }

  private getLastCachedDate(scores: SunsetScore[], timeZone: string): string | null {
    if (scores.length === 0) {
      return null;
    }

    return getDateStringInTimezone(scores[scores.length - 1].date, timeZone);
  }

  private buildMissingDateStrings(
    lastCachedDate: string | null,
    yearStartDate: string,
    todayDateString: string
  ): string[] {
    const dates: string[] = [];
    let current = lastCachedDate ? this.addOneDay(lastCachedDate) : yearStartDate;

    while (current < todayDateString) {
      dates.push(current);
      current = this.addOneDay(current);
    }

    return dates;
  }

  private addOneDay(dateString: string): string {
    const date = new Date(`${dateString}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  }
}

export const sunsetService = new SunsetService();
