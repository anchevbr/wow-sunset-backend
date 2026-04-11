import { config } from '../config';
import { Coordinates } from '../models/types';

/**
 * Normalize coordinates to specified precision for cache keys
 */
export const normalizeCoordinates = (coords: Coordinates): Coordinates => {
  const precision = config.cache.coordinatesPrecision;
  return {
    lat: Number(coords.lat.toFixed(precision)),
    lng: Number(coords.lng.toFixed(precision)),
  };
};

/**
 * Generate unique location ID from normalized coordinates
 */
export const generateLocationId = (coords: Coordinates): string => {
  const normalized = normalizeCoordinates(coords);
  return `loc_${normalized.lat}_${normalized.lng}`;
};


