import axios, { AxiosInstance } from 'axios';
import { format, parseISO } from 'date-fns';
import SunCalc from 'suncalc';
import { logger } from '../utils/logger';
import { cacheService } from '../cache';
import {
  Coordinates,
  HistoricalWeatherSnapshot,
  WeatherConditions,
  CloudType,
  NormalizedLocation,
  OpenMeteoTimeValue,
  OpenMeteoWeatherResponse,
  OpenMeteoAirQualityResponse,
  OpenMeteoGeocodingResponse,
  OpenMeteoGeocodingResult,
  ServiceResult,
} from '../models/types';
import { generateLocationId } from '../utils/helpers';
import { getDateStringInTimezone } from '../utils/timezone';

/**
 * Open-Meteo API Service
 * 
 * Provides weather forecasts, historical data, air quality, and geocoding.
 * 
 * APIs used:
 * - Weather Forecast: https://api.open-meteo.com/v1/forecast
 * - Air Quality: https://air-quality-api.open-meteo.com/v1/air-quality
 * - Historical: https://archive-api.open-meteo.com/v1/archive
 * - Geocoding: https://geocoding-api.open-meteo.com/v1/search
 * 
 * FREE for non-commercial use (up to 10,000 calls/day)
 * No API key required!
 */
class OpenMeteoService {
  private readonly weatherClient: AxiosInstance;
  private readonly airQualityClient: AxiosInstance;
  private readonly archiveClient: AxiosInstance;
  private readonly geocodingClient: AxiosInstance;

  constructor() {
    // Weather Forecast API
    this.weatherClient = axios.create({
      baseURL: 'https://api.open-meteo.com/v1',
      timeout: 10000,
      headers: {
        'Accept': 'application/json',
      },
    });

    // Air Quality API
    this.airQualityClient = axios.create({
      baseURL: 'https://air-quality-api.open-meteo.com/v1',
      timeout: 10000,
      headers: {
        'Accept': 'application/json',
      },
    });

    // Historical Archive API
    this.archiveClient = axios.create({
      baseURL: 'https://archive-api.open-meteo.com/v1',
      timeout: 15000, // Historical queries can be slower
      headers: {
        'Accept': 'application/json',
      },
    });

    // Geocoding API
    this.geocodingClient = axios.create({
      baseURL: 'https://geocoding-api.open-meteo.com/v1',
      timeout: 5000,
      headers: {
        'Accept': 'application/json',
      },
    });
  }

  /**
   * Get weather forecast for next 5 days
   */
  async getForecast(coords: Coordinates, timeZone = 'auto'): Promise<ServiceResult<WeatherConditions[]>> {
    try {
      logger.info('Fetching Open-Meteo forecast', { coords });

      // Fetch weather and air quality in parallel
      const [weatherResponse, airQualityResponse] = await Promise.all([
        this.weatherClient.get<OpenMeteoWeatherResponse>('/forecast', {
          params: {
            latitude: coords.lat,
            longitude: coords.lng,
            hourly: [
              'temperature_2m',
              'relative_humidity_2m',
              'dew_point_2m',
              'precipitation',
              'weather_code',
              'cloud_cover',
              'cloud_cover_low',
              'cloud_cover_mid',
              'cloud_cover_high',
              'visibility',
              'vapour_pressure_deficit',
              'pressure_msl',
              'wind_speed_10m',
              'wind_direction_10m',
            ].join(','),
            forecast_days: 5,
            timezone: timeZone,
            timeformat: 'unixtime',
          },
        }),
        this.airQualityClient.get<OpenMeteoAirQualityResponse>('/air-quality', {
          params: {
            latitude: coords.lat,
            longitude: coords.lng,
            hourly: ['pm10', 'pm2_5', 'us_aqi', 'aerosol_optical_depth', 'dust'].join(','),
            forecast_days: 5,
            timezone: timeZone,
            timeformat: 'unixtime',
          },
        }),
      ]);

      // Merge weather and air quality data
      const conditions = this.mergeWeatherAndAirQuality(
        weatherResponse.data,
        airQualityResponse.data
      );

      if (conditions.length === 0) {
        return {
          success: false,
          error: {
            message: 'Open-Meteo returned no usable forecast data',
            code: 'FORECAST_ERROR',
          },
        };
      }

      logger.info('Successfully fetched forecast', {
        coords,
        dataPoints: conditions.length,
      });

      return {
        success: true,
        data: conditions,
      };
    } catch (error) {
      logger.error('Failed to fetch forecast from Open-Meteo', { error, coords });
      return {
        success: false,
        error: {
          message: 'Failed to fetch weather forecast',
          code: 'FORECAST_ERROR',
          originalError: error instanceof Error ? error : undefined,
        },
      };
    }
  }

  /**
   * Get historical weather data for a specific date
   */
  async getHistorical(
    coords: Coordinates,
    date: Date,
    timeZone = 'auto'
  ): Promise<ServiceResult<HistoricalWeatherSnapshot>> {
    const dateStr = format(date, 'yyyy-MM-dd');

    const rangeResult = await this.getHistoricalRange(coords, dateStr, dateStr, timeZone);
    if (!rangeResult.success) {
      return {
        success: false,
        error: rangeResult.error,
      };
    }

    const snapshot = rangeResult.data?.[0]?.snapshot;
    if (!snapshot) {
      return {
        success: false,
        error: {
          message: 'No historical data available for this date',
          code: 'NO_DATA',
        },
      };
    }

    return {
      success: true,
      data: snapshot,
    };
  }

  async getHistoricalRange(
    coords: Coordinates,
    startDate: string,
    endDate: string,
    timeZone = 'auto'
  ): Promise<ServiceResult<Array<{ date: string; snapshot: HistoricalWeatherSnapshot }>>> {
    try {
      logger.info('Fetching Open-Meteo historical data', {
        coords,
        startDate,
        endDate,
      });

      const conditionsResult = await this.fetchHistoricalConditions(
        coords,
        startDate,
        endDate,
        timeZone
      );

      if (!conditionsResult.success || !conditionsResult.data) {
        return {
          success: false,
          error: conditionsResult.error,
        };
      }

      const conditions = conditionsResult.data;

      if (conditions.length === 0) {
        return {
          success: false,
          error: {
            message: 'No historical data available for the requested period',
            code: 'NO_DATA',
          },
        };
      }

      const snapshots = Array.from(this.groupConditionIndexesByDay(conditions, timeZone).entries())
        .sort(([leftDate], [rightDate]) => leftDate.localeCompare(rightDate))
        .map(([date, indexes]) => {
          const selectedIndex = this.selectConditionIndexForDay(conditions, indexes, coords);

          return {
            date,
            snapshot: this.buildHistoricalSnapshot(conditions, selectedIndex),
          };
        });

      if (snapshots.length === 0) {
        return {
          success: false,
          error: {
            message: 'No historical data available for the requested period',
            code: 'NO_DATA',
          },
        };
      }

      logger.info('Successfully fetched historical range', {
        coords,
        startDate,
        endDate,
        days: snapshots.length,
      });

      return {
        success: true,
        data: snapshots,
      };
    } catch (error) {
      logger.error('Failed to fetch historical range from Open-Meteo', {
        error,
        coords,
        startDate,
        endDate,
      });
      return {
        success: false,
        error: {
          message: 'Failed to fetch historical weather data',
          code: 'HISTORICAL_ERROR',
          originalError: error instanceof Error ? error : undefined,
        },
      };
    }
  }

  private async fetchHistoricalConditions(
    coords: Coordinates,
    startDate: string,
    endDate: string,
    timeZone: string
  ): Promise<ServiceResult<WeatherConditions[]>> {
    try {
      const response = await this.archiveClient.get<OpenMeteoWeatherResponse>('/archive', {
        params: {
          latitude: coords.lat,
          longitude: coords.lng,
          start_date: startDate,
          end_date: endDate,
          hourly: [
            'temperature_2m',
            'relative_humidity_2m',
            'dew_point_2m',
            'precipitation',
            'weather_code',
            'cloud_cover',
            'cloud_cover_low',
            'cloud_cover_mid',
            'cloud_cover_high',
            'vapour_pressure_deficit',
            'pressure_msl',
            'wind_speed_10m',
            'wind_direction_10m',
          ].join(','),
          timezone: timeZone,
          timeformat: 'unixtime',
        },
      });

      return {
        success: true,
        data: this.parseWeatherResponse(response.data),
      };
    } catch (error) {
      logger.error('Failed to fetch historical conditions from Open-Meteo', {
        error,
        coords,
        startDate,
        endDate,
      });
      return {
        success: false,
        error: {
          message: 'Failed to fetch historical weather data',
          code: 'HISTORICAL_ERROR',
          originalError: error instanceof Error ? error : undefined,
        },
      };
    }
  }

  private groupConditionIndexesByDay(
    conditions: WeatherConditions[],
    timeZone: string
  ): Map<string, number[]> {
    const grouped = new Map<string, number[]>();

    conditions.forEach((condition, index) => {
      const dayKey = getDateStringInTimezone(condition.timestamp, timeZone);
      const indexes = grouped.get(dayKey);

      if (indexes) {
        indexes.push(index);
        return;
      }

      grouped.set(dayKey, [index]);
    });

    return grouped;
  }

  private selectConditionIndexForDay(
    conditions: WeatherConditions[],
    dayIndexes: number[],
    coords: Coordinates
  ): number {
    const referenceIndex = dayIndexes[Math.floor(dayIndexes.length / 2)];
    const sunsetTimestamp = SunCalc.getTimes(
      conditions[referenceIndex].timestamp,
      coords.lat,
      coords.lng
    ).sunset.getTime();

    return dayIndexes.reduce((closestIndex, currentIndex) => {
      const closestDiff = Math.abs(conditions[closestIndex].timestamp.getTime() - sunsetTimestamp);
      const currentDiff = Math.abs(conditions[currentIndex].timestamp.getTime() - sunsetTimestamp);
      return currentDiff < closestDiff ? currentIndex : closestIndex;
    }, dayIndexes[0]);
  }

  private buildHistoricalSnapshot(
    conditions: WeatherConditions[],
    selectedIndex: number
  ): HistoricalWeatherSnapshot {
    const selected = conditions[selectedIndex];
    const previous = selectedIndex > 0 ? conditions[selectedIndex - 1] : undefined;
    const recentPrecipitation = conditions
      .slice(Math.max(0, selectedIndex - 4), selectedIndex)
      .reduce((sum, condition) => sum + (condition.precipitation ?? 0), 0);

    return {
      selected,
      previous,
      recentPrecipitation,
    };
  }

  /**
   * Reverse geocode coordinates to location name
   * Note: Open-Meteo doesn't have a dedicated reverse geocoding endpoint,
   * so we search for nearby cities and pick the closest one
   */
  async reverseGeocode(coords: Coordinates): Promise<ServiceResult<NormalizedLocation>> {
    const locationId = generateLocationId(coords);
    const cached = await cacheService.get<NormalizedLocation>('reverse-geocoding', locationId);

    if (cached) {
      logger.info('✅ Cache HIT - returning cached location metadata', { locationId });
      return {
        success: true,
        data: cached,
        fromCache: true,
      };
    }

    try {
      logger.info('Reverse geocoding', { coords });

      // Search for any location near these coordinates
      // We'll use a generic search and filter by distance
      const response = await this.geocodingClient.get<OpenMeteoGeocodingResponse>('/search', {
        params: {
          name: `${coords.lat.toFixed(2)},${coords.lng.toFixed(2)}`,
          count: 1,
          language: 'en',
          format: 'json',
        },
      });

      if (!response.data.results || response.data.results.length === 0) {
        // If no results, create a generic location based on coordinates
        const location = await this.createGenericLocation(coords);
        await cacheService.set('reverse-geocoding', locationId, location);

        return {
          success: true,
          data: location,
          fromCache: false,
        };
      }

      const result = response.data.results[0];
      const location = this.mapToNormalizedLocation(result, coords);

      await cacheService.set('reverse-geocoding', locationId, location);

      logger.info('Successfully reverse geocoded', { coords, location: location.name });

      return {
        success: true,
        data: location,
        fromCache: false,
      };
    } catch (error) {
      logger.error('Failed to reverse geocode', { error, coords });
      
      // Return a generic location on error
      const location = await this.createGenericLocation(coords);
      await cacheService.set('reverse-geocoding', locationId, location);

      return {
        success: true,
        data: location,
        fromCache: false,
      };
    }
  }

  /**
   * Merge weather and air quality data into WeatherConditions array
   */
  private mergeWeatherAndAirQuality(
    weather: OpenMeteoWeatherResponse,
    airQuality: OpenMeteoAirQualityResponse
  ): WeatherConditions[] {
    const conditions: WeatherConditions[] = [];

    // Parse weather data first
    const weatherConditions = this.parseWeatherResponse(weather);

    // Create a map of air quality data by timestamp
    const aqiMap = new Map<number, number>();
    if (airQuality.hourly?.time && airQuality.hourly?.us_aqi) {
      airQuality.hourly.time.forEach((time, index) => {
        const aqi = airQuality.hourly.us_aqi?.[index];
        if (aqi !== undefined && aqi !== null) {
          aqiMap.set(this.parseTimestamp(time).getTime(), aqi);
        }
      });
    }

    // Merge AQI data into weather conditions
    weatherConditions.forEach(condition => {
      const aqi = aqiMap.get(condition.timestamp.getTime());
      
      conditions.push({
        ...condition,
        aqi: aqi ?? undefined,
      });
    });

    return conditions;
  }

  /**
   * Parse weather response into WeatherConditions array
   */
  private parseWeatherResponse(response: OpenMeteoWeatherResponse): WeatherConditions[] {
    const conditions: WeatherConditions[] = [];
    const { hourly } = response;

    if (!hourly?.time?.length) {
      logger.warn('Open-Meteo response missing hourly timestamps', {
        timezone: response.timezone,
      });
      return conditions;
    }

    const expectedLength = hourly.time.length;
    const requiredSeries: Array<[string, number[] | undefined]> = [
      ['temperature_2m', hourly.temperature_2m],
      ['relative_humidity_2m', hourly.relative_humidity_2m],
      ['precipitation', hourly.precipitation],
      ['weather_code', hourly.weather_code],
      ['cloud_cover', hourly.cloud_cover],
      ['cloud_cover_low', hourly.cloud_cover_low],
      ['cloud_cover_mid', hourly.cloud_cover_mid],
      ['cloud_cover_high', hourly.cloud_cover_high],
      ['pressure_msl', hourly.pressure_msl],
      ['wind_speed_10m', hourly.wind_speed_10m],
      ['wind_direction_10m', hourly.wind_direction_10m],
    ];
    const invalidSeries = requiredSeries.find(([, series]) => !series || series.length !== expectedLength);

    if (invalidSeries) {
      logger.warn('Malformed Open-Meteo hourly response', {
        field: invalidSeries[0],
        expectedLength,
        actualLength: invalidSeries[1]?.length,
        timezone: response.timezone,
      });
      return conditions;
    }

    for (let i = 0; i < hourly.time.length; i++) {
      const timestamp = this.parseTimestamp(hourly.time[i]);

      if (Number.isNaN(timestamp.getTime())) {
        logger.warn('Skipping invalid Open-Meteo timestamp', {
          value: hourly.time[i],
          timezone: response.timezone,
        });
        continue;
      }
      
      // Infer cloud types from altitude layers
      const cloudTypes = this.inferCloudTypes(
        hourly.cloud_cover_low?.[i] ?? 0,
        hourly.cloud_cover_mid?.[i] ?? 0,
        hourly.cloud_cover_high?.[i] ?? 0
      );

      const weatherCode = hourly.weather_code?.[i] ?? 0;

      conditions.push({
        timestamp,
        temperature: hourly.temperature_2m?.[i] ?? 0,
        humidity: hourly.relative_humidity_2m?.[i] ?? 0,
        dewPoint: hourly.dew_point_2m?.[i] ?? undefined,
        vaporPressureDeficit: hourly.vapour_pressure_deficit?.[i] ?? undefined,
        pressure: hourly.pressure_msl?.[i] ?? 1013,
        visibility: hourly.visibility?.[i] ?? undefined,
        cloudCover: hourly.cloud_cover?.[i] ?? 0,
        cloudCoverLow: hourly.cloud_cover_low?.[i] ?? 0,
        cloudCoverMid: hourly.cloud_cover_mid?.[i] ?? 0,
        cloudCoverHigh: hourly.cloud_cover_high?.[i] ?? 0,
        cloudTypes,
        windSpeed: hourly.wind_speed_10m?.[i] ?? 0,
        windDirection: hourly.wind_direction_10m?.[i] ?? 0,
        precipitation: hourly.precipitation?.[i] ?? 0,
        weatherCode: weatherCode.toString(),
      });
    }

    return conditions;
  }

  private parseTimestamp(value: OpenMeteoTimeValue): Date {
    if (typeof value === 'number') {
      return new Date(value * 1000);
    }

    if (/^\d+$/.test(value)) {
      return new Date(Number(value) * 1000);
    }

    return parseISO(value);
  }

  /**
   * Infer cloud types from altitude layers
   * 
   * Open-Meteo provides cloud cover by altitude:
   * - cloud_cover_low: 0-3 km
   * - cloud_cover_mid: 3-8 km  
   * - cloud_cover_high: 8+ km
   * 
   * We infer cloud types based on these layers
   */
  private inferCloudTypes(
    cloudLow: number,
    cloudMid: number,
    cloudHigh: number
  ): CloudType[] {
    const types: CloudType[] = [];

    // High clouds (8+ km altitude)
    if (cloudHigh > 50) {
      types.push('cirrus'); // Wispy high clouds
    } else if (cloudHigh > 20) {
      types.push('cirrocumulus'); // Small puffy high clouds
    } else if (cloudHigh > 10) {
      types.push('cirrostratus'); // High sheet clouds
    }

    // Mid-level clouds (3-8 km altitude)
    if (cloudMid > 60) {
      types.push('altostratus'); // Gray mid-level sheet
    } else if (cloudMid > 30) {
      types.push('altocumulus'); // Puffy mid-level - BEST for sunsets!
    }

    // Low clouds (0-3 km altitude)
    if (cloudLow > 70) {
      types.push('stratus'); // Uniform low gray layer
    } else if (cloudLow > 40) {
      types.push('stratocumulus'); // Lumpy low clouds
    } else if (cloudLow > 20) {
      types.push('cumulus'); // Fair-weather puffy clouds
    }

    // If no significant cloud layers, mark as clear
    if (types.length === 0 && cloudLow < 10 && cloudMid < 10 && cloudHigh < 10) {
      types.push('clear');
    }

    return types;
  }

  /**
   * Map Open-Meteo geocoding result to NormalizedLocation
   */
  private mapToNormalizedLocation(
    result: OpenMeteoGeocodingResult,
    coords: Coordinates
  ): NormalizedLocation {
    const parts: string[] = [result.name];
    if (result.admin1) parts.push(result.admin1);
    if (result.country) parts.push(result.country);

    return {
      id: `${coords.lat.toFixed(2)},${coords.lng.toFixed(2)}`,
      name: result.name,
      coordinates: coords,
      normalizedCoordinates: {
        lat: parseFloat(coords.lat.toFixed(2)),
        lng: parseFloat(coords.lng.toFixed(2)),
      },
      country: result.country,
      region: result.admin1,
      timezone: result.timezone || 'UTC',
      formattedAddress: parts.join(', '),
    };
  }

  /**
   * Create a generic location for coordinates without geocoding data
   */
  private async createGenericLocation(coords: Coordinates): Promise<NormalizedLocation> {
    const timezone = await this.resolveTimezone(coords);

    return {
      id: `${coords.lat.toFixed(2)},${coords.lng.toFixed(2)}`,
      name: `Location (${coords.lat.toFixed(2)}°, ${coords.lng.toFixed(2)}°)`,
      coordinates: coords,
      normalizedCoordinates: {
        lat: parseFloat(coords.lat.toFixed(2)),
        lng: parseFloat(coords.lng.toFixed(2)),
      },
      timezone,
      formattedAddress: `${coords.lat.toFixed(4)}°, ${coords.lng.toFixed(4)}°`,
    };
  }

  private async resolveTimezone(coords: Coordinates): Promise<string> {
    try {
      const response = await this.weatherClient.get<{ timezone?: string }>('/forecast', {
        params: {
          latitude: coords.lat,
          longitude: coords.lng,
          current: 'temperature_2m',
          timezone: 'auto',
          forecast_days: 1,
        },
      });

      return response.data.timezone || 'UTC';
    } catch (error) {
      logger.warn('Failed to resolve timezone from coordinates', { coords, error });
      return 'UTC';
    }
  }

}

export default new OpenMeteoService();
