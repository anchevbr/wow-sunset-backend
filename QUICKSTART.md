# Quick Start

## Prerequisites

- Node.js `>= 18`
- Redis

## Install

```bash
npm install
cp .env.example .env
```

## Start Redis

Example with Docker:

```bash
docker run -d -p 6379:6379 --name sunset-redis redis:alpine
```

Check it:

```bash
redis-cli ping
```

Expected result:

```text
PONG
```

## Run The API

Development:

```bash
npm run dev
```

Production-style local run:

```bash
npm run build
npm start
```

## First Calls

Health:

```bash
curl http://localhost:3000/api/health
```

Reverse location from coordinates:

```bash
curl -X POST http://localhost:3000/api/location/reverse \
  -H "Content-Type: application/json" \
  -d '{"lat":37.9838,"lng":23.7275}'
```

Forecast:

```bash
curl -X POST http://localhost:3000/api/sunset/forecast \
  -H "Content-Type: application/json" \
  -d '{"lat":37.9838,"lng":23.7275}'
```

Historical day:

```bash
curl -X POST http://localhost:3000/api/sunset/historical \
  -H "Content-Type: application/json" \
  -d '{"lat":37.9838,"lng":23.7275,"date":"2026-01-15"}'
```

Best days this year:

```bash
curl -X POST http://localhost:3000/api/sunset/historical/best \
  -H "Content-Type: application/json" \
  -d '{"lat":37.9838,"lng":23.7275,"limit":5}'
```

## Common Issues

Redis connection failed:

- Make sure Redis is running.
- Check `REDIS_HOST`, `REDIS_PORT`, and `REDIS_PASSWORD`.

Future historical date rejected:

- `POST /api/sunset/historical` does not allow future dates.

Rate-limited:

- Reduce request rate or change `RATE_LIMIT_*` values in `.env`.

Wrong frontend origin blocked:

- Set `CORS_ORIGIN` in `.env` to your frontend URL.

## Next Steps

1. **Read the Documentation**
   - `API.md` - Complete API reference
   - `ARCHITECTURE.md` - System design details

2. **Test Different Locations**
   - Try various coordinates
   - Check cache behavior

3. **Monitor Performance**
   - Watch console logs for cache hits/misses
   - Monitor Redis memory usage
   - Check API response times

4. **Prepare for Frontend**
   - Review API response formats
   - Test error scenarios
   - Plan UI/UX based on data structure

## Stopping the Application

```bash
# In development mode (npm run dev)
Press Ctrl+C

# Stop Redis Docker container
docker stop sunset-redis

# Stop Redis service (if installed locally)
# macOS
brew services stop redis

# Linux
sudo service redis-server stop
```

## Additional Resources

- [Open-Meteo API Docs](https://open-meteo.com/en/docs)
- [Redis Documentation](https://redis.io/documentation)
- [Express.js Guide](https://expressjs.com/en/guide/routing.html)

## Getting Help

If you encounter issues:
1. Check the console logs for error messages
2. Verify all environment variables are set correctly
3. Ensure Redis is running and accessible
4. Test API keys directly with provider APIs
5. Check that all dependencies are installed: `npm install`

---

**You're all set! The backend is now ready for development.** 🌅
