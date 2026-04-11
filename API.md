 # API Documentation

## Base URL

Forecast:

```bash
curl -X POST http://localhost:3000/api/sunset/forecast \
  -H "Content-Type: application/json" \
  -d '{"lat":48.8566,"lng":2.3522}'
```

Historical day:

```bash
curl -X POST http://localhost:3000/api/sunset/historical \
  -H "Content-Type: application/json" \
  -d '{"lat":48.8566,"lng":2.3522,"date":"2026-01-15"}'
```

Best days this year:

```ts
curl -X POST http://localhost:3000/api/sunset/historical/best \
  success: boolean;
  -d '{"lat":48.8566,"lng":2.3522,"limit":5}'

### cURL Examples
```

Historical day:
const response = await fetch('http://localhost:3000/api/sunset/forecast', {
curl -X POST http://localhost:3000/api/sunset/historical \
  -H "Content-Type: application/json" \
  -d '{"lat":48.8566,"lng":2.3522,"date":"2026-01-15"}'
    lat: 51.5074,
    lng: -0.1278,
Best days this year:

const data = await response.json();
  body: JSON.stringify({
    lat: 51.5074,
    lng: -0.1278,
  }),
});

const data = await response.json();
```

### `POST /api/location/reverse`

Resolves coordinates into a normalized location record.

Request body:

```json
{
  "lat": 37.9838,
  "lng": 23.7275
}
```

Example response:

```json
{
  "success": true,
  "data": {
    "id": "37.98,23.73",
    "name": "Athens",
    "coordinates": {
      "lat": 37.9838,
      "lng": 23.7275
    },
    "normalizedCoordinates": {
      "lat": 37.98,
      "lng": 23.73
    },
    "country": "Greece",
    "region": "Attica",
    "timezone": "Europe/Athens",
    "formattedAddress": "Athens, Attica, Greece"
  },
  "meta": {
    "timestamp": "2026-04-11T17:25:25.142Z",
    "cached": true
  }
}
```

### `POST /api/sunset/forecast`

Returns forecast scores plus year-to-date historical scores for the same location.

Request body:

```json
{
  "lat": 37.9838,
  "lng": 23.7275
}
```

Notes:

- All returned timestamps are formatted in the request location's local timezone.
- `forecasts` contains scored forecast entries.
- `historical` contains year-to-date scored days.

Example response excerpt:

```json
{
  "success": true,
  "data": {
    "location": {
      "name": "Location (37.98°, 23.73°)",
      "timezone": "Europe/Athens"
    },
    "forecasts": [
      {
        "score": 72,
        "date": "2026-04-11T00:00:00+03:00",
        "sunsetTime": "2026-04-10T19:58:31+03:00",
        "confidence": 0.83,
        "factors": {
          "cloudCoverage": {
            "value": 32,
            "score": 94,
            "weight": 0.4,
            "impact": "positive"
          }
        }
      }
    ],
    "historical": []
  },
  "meta": {
    "timestamp": "2026-04-11T17:25:25+03:00",
    "cached": false
  }
}
```

### `POST /api/sunset/historical`

Returns the scored sunset result for one historical day.

Request body:

```json
{
  "lat": 37.9838,
  "lng": 23.7275,
  "date": "2026-01-15"
}
```

Rules:

- `date` must be `YYYY-MM-DD`.
- Future dates are rejected.

Example response excerpt:

```json
{
  "success": true,
  "data": {
    "location": {
      "timezone": "Europe/Athens"
    },
    "score": 61,
    "date": "2026-01-15T00:00:00+02:00",
    "sunsetTime": "2026-01-15T17:29:51+02:00",
    "confidence": 0.79,
    "factors": {
      "cloudCoverage": {
        "value": 48,
        "score": 100,
        "weight": 0.4,
        "impact": "positive"
      }
    }
  },
  "meta": {
    "timestamp": "2026-04-11T17:25:25+03:00"
  }
}
```

### `POST /api/sunset/historical/best`

Returns the best scored days in the current local calendar year for the given coordinates.

Request body:

```json
{
  "lat": 37.9838,
  "lng": 23.7275,
  "limit": 5
}
```

Rules:

- `limit` is optional.
- `limit` must be between `1` and `5`.

Example response excerpt:

```json
{
  "success": true,
  "data": {
    "location": {
      "timezone": "Europe/Athens"
    },
    "bestDays": [
      {
        "score": 91,
        "date": "2026-03-24T00:00:00+02:00",
        "sunsetTime": "2026-03-24T18:37:12+02:00",
        "confidence": 0.91,
        "factors": {
          "cloudCoverage": {
            "value": 41,
            "score": 100,
            "weight": 0.4,
            "impact": "positive"
          }
        }
      }
    ],
    "totalDaysAnalyzed": 100
  },
  "meta": {
    "timestamp": "2026-04-11T17:25:25+03:00"
  }
}
```

## Validation Rules

- `lat`: number between `-90` and `90`
- `lng`: number between `-180` and `180`
- `date`: `YYYY-MM-DD`
- `limit`: integer `1` to `5`

Validation failures return HTTP `400`.

## Caching Notes

- Forecast requests can return `meta.cached: true` on repeated calls.
- Historical best-of-year reads from a persistent incremental year-to-date cache.
- Health endpoints are not cached.

## Quick Reference

For a shorter request/response cheat sheet, see `API_CALLS.md`.

## Error Codes

| Code | Meaning |
|------|---------|
| `VALIDATION_ERROR` | Invalid request body or parameter values |
| `LOCATION_NOT_FOUND` | Reverse geocoding could not resolve the location |
| `FORECAST_ERROR` | Forecast data could not be produced |
| `HISTORICAL_ERROR` | Historical weather data could not be produced |
| `BEST_HISTORICAL_ERROR` | Best historical days could not be produced |
| `RATE_LIMIT_EXCEEDED` | Too many requests in the current rate-limit window |
| `INTERNAL_ERROR` | Unexpected server-side failure |

## Example Usage

### cURL Examples

Forecast:

```bash
curl -X POST http://localhost:3000/api/sunset/forecast \
  -H "Content-Type: application/json" \
  -d '{"lat":48.8566,"lng":2.3522}'
```

Historical day:

```bash
curl -X POST http://localhost:3000/api/sunset/historical \
  -H "Content-Type: application/json" \
  -d '{"lat":48.8566,"lng":2.3522,"date":"2026-01-15"}'
```

Best days this year:

```bash
curl -X POST http://localhost:3000/api/sunset/historical/best \
  -H "Content-Type: application/json" \
  -d '{"lat":48.8566,"lng":2.3522,"limit":5}'
```

### JavaScript/Fetch Example

```javascript
const response = await fetch('http://localhost:3000/api/sunset/forecast', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    lat: 51.5074,
    lng: -0.1278,
  }),
});

const data = await response.json();
```

## Notes

- All sunset timestamps are ISO 8601 strings with the location's UTC offset.
- Coordinates use WGS84 latitude and longitude.
- Historical scoring uses archive data anchored to the target local day.
