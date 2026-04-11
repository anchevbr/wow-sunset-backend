import { SunsetForecast, SunsetScore } from '../models/types';

type DateLike = Date | string;

export interface SerializedSunsetScore extends Omit<SunsetScore, 'date' | 'sunsetTime'> {
  date: string;
  sunsetTime: string;
}

export interface SerializedSunsetForecast extends Omit<SunsetForecast, 'forecasts' | 'historical' | 'generatedAt'> {
  forecasts: SerializedSunsetScore[];
  historical: SerializedSunsetScore[];
  generatedAt: string;
}

export const formatDateTimeInTimezone = (value: DateLike, timeZone: string): string => {
  const date = value instanceof Date ? value : new Date(value);
  const parts = getZonedParts(date, timeZone);
  const offset = normalizeOffset(parts.timeZoneName);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
};

export const formatSunsetTimeInTimezone = (
  value: DateLike,
  referenceDate: DateLike,
  timeZone: string
): string => {
  if (typeof value === 'string') {
    const match = value.match(/^(\d{2}:\d{2}:\d{2})\s(Z|[+-]\d{2}:\d{2})$/);
    if (match) {
      const referenceParts = getZonedParts(referenceDate instanceof Date ? referenceDate : new Date(referenceDate), timeZone);
      return `${referenceParts.year}-${referenceParts.month}-${referenceParts.day}T${match[1]}${match[2]}`;
    }
  }

  return formatDateTimeInTimezone(value, timeZone);
};

const getZonedParts = (date: Date, timeZone: string): Record<string, string> => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'shortOffset',
  });

  return formatter.formatToParts(date).reduce<Record<string, string>>((acc, part) => {
    if (part.type !== 'literal') {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});
};

export const serializeSunsetScore = (
  score: SunsetScore | (Omit<SunsetScore, 'date' | 'sunsetTime'> & { date: DateLike; sunsetTime: DateLike }),
  timeZone: string
): SerializedSunsetScore => ({
  ...score,
  date: formatDateTimeInTimezone(score.date, timeZone),
  sunsetTime: formatSunsetTimeInTimezone(score.sunsetTime, score.date, timeZone),
});

export const serializeSunsetForecast = (
  forecast: SunsetForecast | (Omit<SunsetForecast, 'forecasts' | 'historical' | 'generatedAt'> & {
    forecasts: Array<SunsetScore | (Omit<SunsetScore, 'date' | 'sunsetTime'> & { date: DateLike; sunsetTime: DateLike })>;
    historical: Array<SunsetScore | (Omit<SunsetScore, 'date' | 'sunsetTime'> & { date: DateLike; sunsetTime: DateLike })>;
    generatedAt: DateLike;
  }),
  timeZone: string
): SerializedSunsetForecast => ({
  ...forecast,
  forecasts: forecast.forecasts.map((score) => serializeSunsetScore(score, timeZone)),
  historical: forecast.historical.map((score) => serializeSunsetScore(score, timeZone)),
  generatedAt: formatDateTimeInTimezone(forecast.generatedAt, timeZone),
});

export const getYearInTimezone = (value: DateLike, timeZone: string): number => {
  const date = value instanceof Date ? value : new Date(value);
  return Number(getZonedParts(date, timeZone).year);
};

export const getDateStringInTimezone = (value: DateLike, timeZone: string): string => {
  const date = value instanceof Date ? value : new Date(value);
  const parts = getZonedParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const normalizeOffset = (rawOffset?: string): string => {
  if (!rawOffset || rawOffset === 'GMT' || rawOffset === 'UTC') {
    return 'Z';
  }

  const match = rawOffset.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!match) {
    return 'Z';
  }

  const [, sign, hours, minutes] = match;
  return `${sign}${hours.padStart(2, '0')}:${(minutes ?? '00').padStart(2, '0')}`;
};
