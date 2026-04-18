# WOW Sunset Backend

Backend API for sunset quality forecasting and historical analysis.

## What It Does

- Scores sunset quality for a coordinate pair
- Returns forecast-based sunset scores
- Returns historical scored sunsets for a specific day
- Returns the best historical days in the current calendar year
- Resolves coordinates into normalized location data and timezone
- Uses Redis for forecast caching and persistent incremental historical caching

## Current API Surface

- `GET /api/health`
- `POST /api/location/reverse`
- `POST /api/sunset/forecast`
- `POST /api/sunset/historical`
- `POST /api/sunset/historical/best`

Optional internal endpoint:

- `GET /api/health/cache` when `ENABLE_CACHE_STATS_ENDPOINT=true`

The backend is coordinate-first. Text search, autocomplete, and address-based forecast endpoints were intentionally removed so frontend clients can own location search UX.

## Stack

- Node.js
- TypeScript
- Express
- Redis
- Open-Meteo APIs
- Winston logging
- Zod validation

## Requirements

- Node.js `>= 18`
- Redis

## Setup

```bash
npm install
cp .env.example .env
```

Set production-safe values in `.env`, especially:

```env
NODE_ENV=production
PORT=3000
TRUST_PROXY=true
CORS_ORIGIN=https://your-frontend.example
INTERNAL_APP_SECRET=change-me
PUBLIC_API_KEYS=free-key-1,free-key-2
ALLOW_ANONYMOUS_API=false
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=change-me
REDIS_DB=0
REDIS_TLS_ENABLED=false
REDIS_TLS_REJECT_UNAUTHORIZED=true
REDIS_PRIVATE_NETWORK=true
JSON_BODY_LIMIT=16kb
URL_ENCODED_BODY_LIMIT=16kb
ENABLE_CACHE_STATS_ENDPOINT=false
```

Production Redis policy:

- `REDIS_PASSWORD` is required in production.
- Use `REDIS_TLS_ENABLED=true` for Redis over non-private networks.
- If Redis stays on a trusted private network, set `REDIS_PRIVATE_NETWORK=true`.

API access model:

- Your own app should call this backend from a trusted app server or BFF using `X-Internal-App-Secret`.
- Trusted first-party server traffic bypasses the public rate limiter.
- Future public/free API consumers should use `X-API-Key` or `Authorization: Bearer <key>` and remain rate limited.
- Anonymous API access is allowed by default in development, but is blocked in production.

## Run

```bash
# development
npm run dev

# production
npm run build
npm start
```

## Behavior Notes

- All sunset-related timestamps are serialized in the request location's local timezone.
- Forecast responses include historical year-to-date scores.
- Best historical responses are backed by a persistent incremental cache that only fetches missing new days.
- Repeated forecast requests can be served directly from Redis.
- `GET /api/health` is a public liveness check and does not expose cache internals.
- Request bodies are capped by default at `16kb`; oversized payloads return HTTP `413`.

## Basic Example

```bash
curl -X POST http://localhost:3000/api/sunset/forecast \
  -H "X-Internal-App-Secret: $INTERNAL_APP_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"lat":37.9838,"lng":23.7275}'
```

## Docs

- `API.md`: fuller endpoint documentation
- `API_CALLS.md`: short copy/paste examples
- `QUICKSTART.md`: local setup and first-run guide

## Production Notes

- Do not leave `CORS_ORIGIN=*` in production.
- Make sure Redis is reachable from the deployed app.
- Set `TRUST_PROXY=true` when running behind a load balancer or reverse proxy so IP-based fallback logic works correctly.
- Production requires authenticated Redis plus either TLS or an explicitly private Redis network.
- Production also requires `INTERNAL_APP_SECRET`; do not call the protected API directly from the browser if you want first-party traffic to bypass public limits.
- Public/free clients should be issued API keys instead of relying on anonymous IP-based access.
- The cache stats endpoint is disabled by default and should only be enabled for trusted internal environments.
- Build before start, or configure your platform to run `npm run build` during deploy.
