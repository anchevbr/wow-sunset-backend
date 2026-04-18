jest.mock('../../cache', () => ({
  cacheService: {
    getStats: jest.fn(),
    isAvailable: jest.fn(),
  },
}));

jest.mock('../../middleware/access-control', () => {
  const actual = jest.requireActual('../../middleware/access-control');
  return {
    ...actual,
  };
});

jest.mock('../../services/sunset.service', () => ({
  sunsetService: {
    getSunsetForecast: jest.fn(),
    getBestHistoricalSunsets: jest.fn(),
  },
}));

jest.mock('../../services/open-meteo.service', () => ({
  __esModule: true,
  default: {
    reverseGeocode: jest.fn(),
    getHistorical: jest.fn(),
  },
}));

jest.mock('../../services/scoring.service', () => ({
  scoringService: {
    calculateScore: jest.fn(),
  },
}));

import request from 'supertest';
import app from '../../index';
import { cacheService } from '../../cache';
import { sunsetService } from '../../services/sunset.service';
import openMeteoService from '../../services/open-meteo.service';
import { scoringService } from '../../services/scoring.service';
import {
  FactorScore,
  HistoricalWeatherSnapshot,
  NormalizedLocation,
  SunsetForecast,
  SunsetScore,
  WeatherConditions,
} from '../../models/types';

const mockedCacheService = cacheService as jest.Mocked<typeof cacheService>;
const mockedSunsetService = sunsetService as jest.Mocked<typeof sunsetService>;
const mockedOpenMeteoService = openMeteoService as jest.Mocked<typeof openMeteoService>;
const mockedScoringService = scoringService as jest.Mocked<typeof scoringService>;

const baseCoordinates = { lat: 37.9838, lng: 23.7275 };

const createFactorScore = (value: number, score: number): FactorScore => ({
  value,
  score,
  weight: 0.1,
  impact: score >= 75 ? 'positive' : score >= 45 ? 'neutral' : 'negative',
});

const createSunsetScore = (date: string, sunsetTime: string, totalScore = 72): SunsetScore => ({
  score: totalScore,
  date: new Date(date),
  sunsetTime: new Date(sunsetTime),
  confidence: 0.82,
  factors: {
    cloudCoverage: createFactorScore(35, 91),
    cloudType: createFactorScore(1, 88),
    atmosphericClarity: createFactorScore(2, 78),
    aerosols: createFactorScore(2, 78),
    humidity: createFactorScore(56, 70),
    pressureTrend: createFactorScore(1014, 67),
    weatherDynamics: createFactorScore(0, 74),
  },
});

const createLocation = (): NormalizedLocation => ({
  id: 'loc_37.98_23.73',
  name: 'Athens',
  coordinates: baseCoordinates,
  normalizedCoordinates: { lat: 37.98, lng: 23.73 },
  country: 'Greece',
  region: 'Attica',
  timezone: 'Europe/Athens',
  formattedAddress: 'Athens, Attica, Greece',
});

const createWeatherConditions = (timestamp: string): WeatherConditions => ({
  timestamp: new Date(timestamp),
  temperature: 23,
  humidity: 51,
  dewPoint: 12,
  vaporPressureDeficit: 0.7,
  pressure: 1014,
  visibility: 12000,
  cloudCover: 32,
  cloudCoverLow: 10,
  cloudCoverMid: 42,
  cloudCoverHigh: 18,
  cloudTypes: ['altocumulus'],
  windSpeed: 4,
  windDirection: 180,
  precipitation: 0,
  weatherCode: '1',
  aqi: 2,
});

describe('API smoke tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCacheService.isAvailable.mockReturnValue(true);
  });

  it('returns public health status without cache internals', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('healthy');
    expect(response.body.data.cache).toBeUndefined();
  });

  it('does not expose cache stats by default', async () => {
    const response = await request(app).get('/api/health/cache');

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('returns a serialized forecast payload', async () => {
    const forecast: SunsetForecast = {
      location: createLocation(),
      forecasts: [createSunsetScore('2026-04-18T00:00:00.000Z', '2026-04-18T16:05:00.000Z')],
      historical: [createSunsetScore('2026-04-10T00:00:00.000Z', '2026-04-10T16:00:00.000Z', 68)],
      generatedAt: new Date('2026-04-18T14:30:00.000Z'),
      cacheKey: 'loc_37.98_23.73',
    };

    mockedSunsetService.getSunsetForecast.mockResolvedValue({
      success: true,
      data: forecast,
      fromCache: true,
    });

    const response = await request(app)
      .post('/api/sunset/forecast')
      .send(baseCoordinates);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.meta.cached).toBe(true);
    expect(response.body.data.location.timezone).toBe('Europe/Athens');
    expect(response.body.data.forecasts).toHaveLength(1);
    expect(response.body.data.historical).toHaveLength(1);
    expect(response.body.data.forecasts[0].score).toBe(72);
    expect(response.body.data.forecasts[0].date).toEqual(expect.any(String));
    expect(response.body.data.forecasts[0].sunsetTime).toEqual(expect.any(String));
    expect(mockedSunsetService.getSunsetForecast).toHaveBeenCalledWith(baseCoordinates);
  });

  it('returns a serialized historical sunset result', async () => {
    const location = createLocation();
    const historicalSnapshot: HistoricalWeatherSnapshot = {
      selected: createWeatherConditions('2026-01-15T15:00:00.000Z'),
      previous: createWeatherConditions('2026-01-15T14:00:00.000Z'),
      recentPrecipitation: 0.4,
    };
    const score = createSunsetScore('2026-01-15T00:00:00.000Z', '2026-01-15T15:28:00.000Z', 61);

    mockedOpenMeteoService.reverseGeocode.mockResolvedValue({
      success: true,
      data: location,
    });
    mockedOpenMeteoService.getHistorical.mockResolvedValue({
      success: true,
      data: historicalSnapshot,
    });
    mockedScoringService.calculateScore.mockReturnValue(score);

    const response = await request(app)
      .post('/api/sunset/historical')
      .send({
        ...baseCoordinates,
        date: '2026-01-15',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.location.name).toBe('Athens');
    expect(response.body.data.score).toBe(61);
    expect(response.body.data.date).toEqual(expect.any(String));
    expect(response.body.data.sunsetTime).toEqual(expect.any(String));
    expect(mockedOpenMeteoService.getHistorical).toHaveBeenCalledWith(
      baseCoordinates,
      expect.any(Date),
      'Europe/Athens'
    );
  });

  it('returns 404 when historical data is unavailable', async () => {
    mockedOpenMeteoService.reverseGeocode.mockResolvedValue({
      success: true,
      data: createLocation(),
    });
    mockedOpenMeteoService.getHistorical.mockResolvedValue({
      success: false,
      error: {
        code: 'NO_DATA',
        message: 'No historical data available for this date',
      },
    });

    const response = await request(app)
      .post('/api/sunset/historical')
      .send({
        ...baseCoordinates,
        date: '2026-01-15',
      });

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('NO_DATA');
  });

  it('rejects invalid historical calendar dates', async () => {
    const response = await request(app)
      .post('/api/sunset/historical')
      .send({
        ...baseCoordinates,
        date: '2026-02-30',
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockedOpenMeteoService.reverseGeocode).not.toHaveBeenCalled();
  });

  it('rejects oversized request bodies', async () => {
    const response = await request(app)
      .post('/api/location/reverse')
      .set('Content-Type', 'application/json')
      .send({
        ...baseCoordinates,
        note: 'x'.repeat(20_000),
      });

    expect(response.status).toBe(413);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(mockedOpenMeteoService.reverseGeocode).not.toHaveBeenCalled();
  });
});