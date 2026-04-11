# API Calls

Small copy/paste guide for calling the backend.

## Base URL

```text
http://localhost:3000/api
```

## Health

```bash
curl http://localhost:3000/api/health
```

## Cache Stats

```bash
curl http://localhost:3000/api/health/cache
```

## Reverse Coordinates To Location

```bash
curl -X POST http://localhost:3000/api/location/reverse \
  -H "Content-Type: application/json" \
  -d '{"lat":37.9838,"lng":23.7275}'
```

## Forecast

```bash
curl -X POST http://localhost:3000/api/sunset/forecast \
  -H "Content-Type: application/json" \
  -d '{"lat":37.9838,"lng":23.7275}'
```

## Historical Day

```bash
curl -X POST http://localhost:3000/api/sunset/historical \
  -H "Content-Type: application/json" \
  -d '{"lat":37.9838,"lng":23.7275,"date":"2026-01-15"}'
```

## Best Historical Days This Year

```bash
curl -X POST http://localhost:3000/api/sunset/historical/best \
  -H "Content-Type: application/json" \
  -d '{"lat":37.9838,"lng":23.7275,"limit":5}'
```

## Validation Rules

- `lat`: `-90` to `90`
- `lng`: `-180` to `180`
- `date`: `YYYY-MM-DD`
- `limit`: `1` to `5`

## What To Expect

- Sunset timestamps come back in the location's local timezone.
- Forecast responses may include `meta.cached: true` on repeated calls.
- Best historical results use the persistent year-to-date cache.