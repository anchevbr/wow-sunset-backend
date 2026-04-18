import { z } from 'zod';

const isValidIsoDate = (value: string): boolean => {
  const date = new Date(`${value}T00:00:00Z`);

  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

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
  date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
    .refine(isValidIsoDate, 'Date must be a valid calendar date'),
});

export const bestHistoricalRequestSchema = coordinatesSchema.extend({
  limit: z.number().int().min(1).max(5).optional().default(5),
});
