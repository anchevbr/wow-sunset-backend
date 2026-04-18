import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const booleanFlagSchema = z.enum(['true', 'false']).optional();

const parseBooleanFlag = (
  value: 'true' | 'false' | undefined,
  fallback: boolean
): boolean => {
  if (value === undefined) {
    return fallback;
  }

  return value === 'true';
};

const isPrivateIpv4Host = (host: string): boolean => {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) {
    return false;
  }

  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  const [first, second] = octets;
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
};

const isPrivateIpv6Host = (host: string): boolean => {
  const normalized = host.toLowerCase();
  return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
};

const isRedisHostLocalOrPrivate = (host: string): boolean => {
  const normalized = host.trim().toLowerCase();
  return normalized === 'localhost' || isPrivateIpv4Host(normalized) || isPrivateIpv6Host(normalized);
};

// Environment variable schema
const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3000'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().transform(Number).default('6379'),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.string().transform(Number).default('0'),
  REDIS_TLS_ENABLED: booleanFlagSchema,
  REDIS_TLS_REJECT_UNAUTHORIZED: booleanFlagSchema,
  REDIS_PRIVATE_NETWORK: booleanFlagSchema,

  // Cache TTLs (seconds)
  CACHE_TTL_GEOCODING: z.string().transform(Number).default('604800'),
  CACHE_TTL_FORECAST: z.string().transform(Number).default('21600'),
  CACHE_TTL_HISTORICAL: z.string().transform(Number).default('2592000'),

  // Precision
  COORDINATES_PRECISION: z.string().transform(Number).default('2'),

  // CORS
  CORS_ORIGIN: z.string().default('*'),

  // Request limits
  JSON_BODY_LIMIT: z.string().default('16kb'),
  URL_ENCODED_BODY_LIMIT: z.string().default('16kb'),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default('900000'),
  RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number).default('100'),

  // Request Deduplication
  REQUEST_LOCK_TTL: z.string().transform(Number).default('30'),

  // Internal ops endpoints
  ENABLE_CACHE_STATS_ENDPOINT: booleanFlagSchema,
});

// Parse and validate environment variables
const parseEnv = () => {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Invalid environment variables:');
      error.errors.forEach((err) => {
        console.error(`  - ${err.path.join('.')}: ${err.message}`);
      });
      process.exit(1);
    }
    throw error;
  }
};

export const env = parseEnv();

// Typed configuration object
export const config = {
  server: {
    env: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    isDevelopment: env.NODE_ENV === 'development',
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
  },

  redis: {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
    db: env.REDIS_DB,
    tlsEnabled: parseBooleanFlag(env.REDIS_TLS_ENABLED, false),
    tlsRejectUnauthorized: parseBooleanFlag(env.REDIS_TLS_REJECT_UNAUTHORIZED, true),
    privateNetwork: parseBooleanFlag(env.REDIS_PRIVATE_NETWORK, false),
  },

  cache: {
    ttl: {
      geocoding: env.CACHE_TTL_GEOCODING,
      forecast: env.CACHE_TTL_FORECAST,
      historical: env.CACHE_TTL_HISTORICAL,
    },
    coordinatesPrecision: env.COORDINATES_PRECISION,
    lockTtl: env.REQUEST_LOCK_TTL,
  },

  cors: {
    origin: env.CORS_ORIGIN,
  },

  request: {
    jsonBodyLimit: env.JSON_BODY_LIMIT,
    urlEncodedBodyLimit: env.URL_ENCODED_BODY_LIMIT,
  },

  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX_REQUESTS,
  },

  health: {
    enableCacheStatsEndpoint: parseBooleanFlag(env.ENABLE_CACHE_STATS_ENDPOINT, false),
  },
} as const;

const validateSecurityConfiguration = (): void => {
  if (!config.server.isProduction) {
    return;
  }

  if (!config.redis.password?.trim()) {
    console.error('❌ REDIS_PASSWORD must be set in production.');
    process.exit(1);
  }

  const redisIsPrivate = isRedisHostLocalOrPrivate(config.redis.host) || config.redis.privateNetwork;
  if (!config.redis.tlsEnabled && !redisIsPrivate) {
    console.error(
      '❌ Production Redis must use TLS or be explicitly marked as private via REDIS_PRIVATE_NETWORK=true.'
    );
    process.exit(1);
  }
};

validateSecurityConfiguration();
