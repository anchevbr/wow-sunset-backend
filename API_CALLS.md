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

Public health is intentionally minimal and does not include cache telemetry.

## First-Party App Server Call

Use this from your own backend server or BFF, not from the browser.

```bash
curl -X POST http://localhost:3000/api/sunset/forecast \
  -H "X-Internal-App-Secret: $INTERNAL_APP_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"lat":37.9838,"lng":23.7275}'
```

Trusted first-party traffic bypasses the public rate limiter.

## Public / Free API Call

Use this for external clients when you issue public API keys.

```bash
curl -X POST http://localhost:3000/api/sunset/forecast \
  -H "X-API-Key: $PUBLIC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"lat":37.9838,"lng":23.7275}'
```

You can also send the key as `Authorization: Bearer $PUBLIC_API_KEY`.

## Optional Internal Cache Stats

Enable with `ENABLE_CACHE_STATS_ENDPOINT=true` only in trusted environments.

```bash
curl http://localhost:3000/api/health/cache \
  -H "X-Internal-App-Secret: $INTERNAL_APP_SECRET"
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
- Request bodies above the configured parser limit return HTTP `413`.
- Public limits are keyed by API identity: first by internal app secret bypass, then by public API key, then by IP fallback when anonymous access is allowed.