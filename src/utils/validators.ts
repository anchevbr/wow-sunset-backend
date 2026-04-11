import { z } from 'zod';

// Coordinates validation schema
const coordinatesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

// Location request schemas
export const reverseGeocodeRequestSchema = coordinatesSchema;

// Forecast request schemas
export const forecastRequestSchema = coordinatesSchema;

// Historical request schema
export const historicalRequestSchema = coordinatesSchema.extend({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
});

export const bestHistoricalRequestSchema = coordinatesSchema.extend({
  limit: z.number().int().min(1).max(5).optional().default(5),
});
