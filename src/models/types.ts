/**
 * Core domain models and types
 */

// ============================================================================
// Location Models
// ============================================================================

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface NormalizedLocation {
  id: string;                    // Unique location identifier (normalized coords)
  name: string;                  // Human-readable location name
  coordinates: Coordinates;      // Exact coordinates
  normalizedCoordinates: Coordinates; // Rounded for caching
  country?: string;
  region?: string;               // State/province
  timezone: string;              // IANA timezone identifier
  formattedAddress?: string;
}

// ============================================================================
// Weather Models
// ============================================================================

export interface WeatherConditions {
  timestamp: Date;
  temperature: number;           // Celsius
  humidity: number;              // Percentage 0-100
  dewPoint?: number;             // Celsius
  vaporPressureDeficit?: number; // kPa
  pressure: number;              // hPa
  visibility?: number;           // meters
  cloudCover: number;            // Percentage 0-100
  cloudCoverLow?: number;        // Percentage 0-100
  cloudCoverMid?: number;        // Percentage 0-100
  cloudCoverHigh?: number;       // Percentage 0-100
  cloudTypes?: CloudType[];      // Detected cloud types
  windSpeed: number;             // m/s
  windDirection: number;         // degrees
  precipitation?: number;        // mm
  weatherCode: string;           // Weather condition code
  uvIndex?: number;
  aqi?: number;                  // Air Quality Index
}

export type CloudType = 
  | 'cirrus'                     // High, wispy
  | 'cirrocumulus'               // High, small puffs
  | 'cirrostratus'               // High, sheet-like
  | 'altocumulus'                // Mid, puffy (IDEAL)
  | 'altostratus'                // Mid, gray sheet
  | 'stratus'                    // Low, uniform gray
  | 'stratocumulus'              // Low, lumpy
  | 'cumulus'                    // Low/mid, fluffy
  | 'cumulonimbus'               // Storm clouds
  | 'clear';                     // No clouds

export interface HistoricalWeatherSnapshot {
  selected: WeatherConditions;
  previous?: WeatherConditions;
  recentPrecipitation?: number;
}

// ============================================================================
// Sunset Score Models
// ============================================================================

export interface SunsetScore {
  score: number;                 // 0-100 quality score
  date: Date;
  sunsetTime: Date;
  confidence: number;            // 0-1 confidence level
  factors: ScoringFactors;
}

export interface ScoringFactors {
  cloudCoverage: FactorScore;
  cloudType: FactorScore;
  atmosphericClarity: FactorScore;
  aerosols: FactorScore;
  humidity: FactorScore;
  pressureTrend: FactorScore;
  weatherDynamics: FactorScore;
}

export interface FactorScore {
  value: number;                 // Raw value
  score: number;                 // Normalized 0-100
  weight: number;                // Weight in final calculation
  impact: 'positive' | 'negative' | 'neutral';
}

// ============================================================================
// Forecast Models
// ============================================================================

export interface SunsetForecast {
  location: NormalizedLocation;
  forecasts: SunsetScore[];      // Next 5 days
  historical: SunsetScore[];     // Current year to date
  generatedAt: Date;
  cacheKey: string;
}

// ============================================================================
// API Response Models
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: {
    timestamp: string;
    requestId?: string;
    cached?: boolean;
  };
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface RequestAccessContext {
  type: 'internal' | 'public' | 'anonymous';
  identifier: string;
  rateLimitBypass: boolean;
}

export type CacheKeyType = 
  | 'reverse-geocoding'
  | 'forecast'
  | 'historical'
  | 'weather';

// ============================================================================
// Service Response Models
// ============================================================================

export interface ServiceResult<T> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code?: string;
    originalError?: Error;
  };
  fromCache?: boolean;
}

// ============================================================================
// Open-Meteo API Models
// ============================================================================

export type OpenMeteoTimeValue = number | string;

export interface OpenMeteoWeatherResponse {
  latitude: number;
  longitude: number;
  elevation: number;
  timezone: string;
  timezone_abbreviation: string;
  hourly: {
    time: OpenMeteoTimeValue[];
    temperature_2m: number[];
    relative_humidity_2m: number[];
    dew_point_2m?: number[];
    precipitation: number[];
    weather_code: number[];
    cloud_cover: number[];
    cloud_cover_low: number[];
    cloud_cover_mid: number[];
    cloud_cover_high: number[];
    visibility?: Array<number | null>;
    vapour_pressure_deficit?: number[];
    pressure_msl: number[];
    wind_speed_10m: number[];
    wind_direction_10m: number[];
  };
  hourly_units: {
    temperature_2m: string;
    relative_humidity_2m: string;
    dew_point_2m?: string;
    precipitation: string;
    weather_code: string;
    cloud_cover: string;
    visibility: string;
    vapour_pressure_deficit?: string;
    pressure_msl: string;
    wind_speed_10m: string;
  };
}

export interface OpenMeteoAirQualityResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  hourly: {
    time: OpenMeteoTimeValue[];
    pm10?: number[];
    pm2_5?: number[];
    us_aqi?: number[];
    european_aqi?: number[];
    aerosol_optical_depth?: number[];
    dust?: number[];
  };
  hourly_units: {
    pm10?: string;
    pm2_5?: string;
    us_aqi?: string;
    aerosol_optical_depth?: string;
    dust?: string;
  };
}

export interface OpenMeteoGeocodingResult {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  elevation?: number;
  timezone?: string;
  feature_code?: string;
  country_code?: string;
  country?: string;
  country_id?: number;
  population?: number;
  postcodes?: string[];
  admin1?: string;
  admin2?: string;
  admin3?: string;
  admin4?: string;
  admin1_id?: number;
  admin2_id?: number;
  admin3_id?: number;
  admin4_id?: number;
}

export interface OpenMeteoGeocodingResponse {
  results?: OpenMeteoGeocodingResult[];
  generationtime_ms?: number;
}
