# Architecture Documentation

## Overview

The WOW Sunset backend is a Node.js/TypeScript application that predicts sunset quality based on real-time and historical atmospheric conditions. The system is designed for production use with emphasis on reliability, caching, and scientific accuracy.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Client                              │
│                    (Future Frontend)                        │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP/JSON
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                     Express Server                          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Middleware Layer                                     │  │
│  │  • CORS, Helmet (security)                           │  │
│  │  • Rate Limiting                                      │  │
│  │  • Request Logging                                    │  │
│  │  • Error Handling                                     │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  API Controllers                                      │  │
│  │  • Location Controller                                │  │
│  │  • Sunset Controller                                  │  │
│  │  • Health Controller                                  │  │
│  └──────────────────────────────────────────────────────┘  │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   Service Layer                             │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Geocoding  │  │   Weather    │  │     Scoring      │  │
│  │   Service   │  │   Service    │  │     Service      │  │
│  │             │  │              │  │                  │  │
│  │  • Forward  │  │  • Forecast  │  │  • Cloud score   │  │
│  │  • Reverse  │  │  • Historical│  │  • Visibility    │  │
│  │  • Auto-    │  │  • AQI data  │  │  • Aerosols      │  │
│  │    complete │  │              │  │  • Humidity      │  │
│  └─────────────┘  └──────────────┘  │  • Pressure      │  │
│                                      │  • Dynamics      │  │
│                                      └──────────────────┘  │
└──────────┬──────────────────┬────────────────────┬─────────┘
           │                  │                    │
           ▼                  ▼                    ▼
    ┌──────────────┐   ┌──────────────┐    ┌──────────────┐
   │ Open-Meteo   │   │ Open-Meteo   │    │    Redis     │
   │  Geocoding   │   │   Weather    │    │    Cache     │
    │     API      │   │     API      │    │              │
    └──────────────┘   └──────────────┘    │  • Geo cache │
                                            │  • Weather   │
                                            │  • Locks     │
                                            └──────────────┘
```

---

## Core Components

### 1. **Service Layer**

#### Open-Meteo Service (`open-meteo.service.ts`)
- **Purpose**: Forecast, archive, air-quality, and reverse geocoding access
- **Provider**: Open-Meteo Geocoding API
- **Features**:
  - Reverse geocoding (coordinates → address)
  - Timezone estimation
  - Result caching (7-day TTL)

#### Weather and Archive Access (`open-meteo.service.ts`)
- **Purpose**: Fetch forecast, archive, and air-quality data
- **Provider**: Open-Meteo APIs
- **Features**:
   - 5-day hourly forecasts
   - Historical weather data without a paid subscription
  - Air Quality Index (AQI)
   - Cloud layer inference from altitude bands
  - Result caching (6-hour TTL for forecasts, 30-day for historical)

#### Scoring Service (`scoring.service.ts`)
- **Purpose**: Calculate sunset quality scores using atmospheric physics
- **Algorithm**: Research-backed multi-factor weighted scoring (0-100)
- **Scientific Basis**: Rayleigh + Mie scattering principles

**Factors (Research-Backed Weights):**
  1. **Cloud Structure (40%)** - THE primary driver
     - Coverage: 25-60% optimal (clouds as projection screens)
     - Type: Mid/high clouds (altocumulus, cirrus) catch light from below
     - Variety: Layered clouds = more dramatic
  
  2. **Atmospheric Clarity (25%)** - Color intensity driver
     - **Key insight**: Moderate particles = BEST (not too clean, not polluted)
     - Visibility (40% of factor): Clear enough to see
     - Aerosols (60% of factor): Small particles enhance reds/oranges (Mie scattering)
     - Optimal: AQI 2-3 (Fair to Moderate)
  
  3. **Humidity (12%)** - Color blender
     - Optimal: 40-70% humidity
     - Creates smooth gradients via moisture scattering
  
  4. **Weather Dynamics (13%)** - The "magic trigger"
     - **Post-storm clearing = EXCEPTIONAL** (100/100 score)
     - Rain removes large particles → clean air + structured clouds
     - Rising pressure indicates improving conditions
  
  5. **Sun Geometry (10%)** - Baseline modifier
     - Seasonal angle (winter = redder)
     - Latitude effects (higher = longer twilight)

**Scoring Logic:**
```typescript
totalScore = 
    (cloudStructure × 0.40) +
    (atmosphericClarity × 0.25) +
    (humidity × 0.12) +
    (weatherDynamics × 0.13) +
    (sunGeometry × 0.10)

confidence = baseConfidence + bonuses(dataCompleteness)
```

**Key Principle:** Best sunsets ≠ perfect weather. Optimal = "partially disturbed" atmosphere.

#### Sunset Service (`sunset.service.ts`)
- **Purpose**: Orchestrate all services
- **Features**:
  - Request deduplication via Redis locks
  - Coordinate normalization for caching
  - Historical data aggregation
  - Complete forecast assembly

---

### 2. **Caching Layer**

#### Redis Cache (`cache/index.ts`)

**Cache Types:**
| Type | TTL | Purpose |
|------|-----|---------|
| `geocoding` | 7 days | Generic geocoding cache bucket |
| `reverse-geocoding` | 7 days | Coordinates → location |
| `forecast` | 6 hours | Weather + sunset scores |
| `historical` | 30 days | Past weather data |

**Key Features:**
- Automatic TTL management
- Distributed locks for request deduplication
- Coordinate normalization (2 decimal places)
- Graceful degradation if Redis unavailable

**Cache Key Format:**
```
sunset:{type}:{identifier}
```

**Normalization Strategy:**
- Coordinates rounded to 2 decimal places (~1.1km precision)
- Users within ~500m radius share cached results
- Balances cache hit rate vs accuracy

---

### 3. **API Layer**

#### Routes
- `/api/location/*` - Reverse geocoding
- `/api/sunset/*` - Sunset forecasts
- `/api/health/*` - System health checks

#### Middleware
- **Security**: Helmet (HTTP headers), CORS
- **Rate Limiting**: 100 requests per 15 minutes
- **Logging**: Request/response logging with Winston
- **Error Handling**: Centralized error middleware
- **Validation**: Zod schema validation

---

## Data Flow

### Sunset Forecast Request Flow

```
1. Client Request
   POST /api/sunset/forecast
   { lat: 37.7749, lng: -122.4194 }
   
2. Controller Validation
   ✓ Validate coordinates
   ✓ Check rate limit
   
3. Service Orchestration
   ├─ Reverse geocode coordinates
   │  └─ Check cache → [HIT or MISS]
   │     └─ If MISS: Call Open-Meteo geocoding → Cache result
   │
   ├─ Check forecast lock (deduplication)
   │  └─ If locked: Wait for in-flight request
   │
   ├─ Fetch 5-day weather forecast
   │  └─ Check cache → [HIT or MISS]
   │     └─ If MISS: Call Open-Meteo weather + air quality → Cache result
   │
   ├─ Fetch air quality data
   │  └─ Enrich weather conditions
   │
   ├─ Calculate sunset scores
   │  └─ For each day: Apply scoring algorithm
   │
   ├─ Fetch historical data (YTD)
   │  └─ For each past day: Fetch weather → Calculate score
   │
   └─ Assemble complete forecast
      └─ Cache combined result
   
4. Response
   {
     success: true,
     data: {
       location: {...},
       forecasts: [5 days],
       historical: [YTD],
       generatedAt: "2026-04-11T..."
     },
     meta: { timestamp, cached: false }
   }
```

---

## Configuration Management

### Environment Variables

**Required:** None

**Optional (with defaults):**
- `NODE_ENV` - development|production|test
- `PORT` - Server port (default: 3000)
- `REDIS_HOST` - Redis hostname (default: localhost)
- `CACHE_TTL_*` - Cache TTLs in seconds
- `RATE_LIMIT_*` - Rate limiting config

**Validation:**
- Zod schema validates all env vars on startup
- Missing required variables cause immediate failure
- Type coercion for numbers and enums

---

## Error Handling

### Error Hierarchy

```
1. Validation Errors (400)
   - Invalid coordinates
   - Malformed requests
   
2. Client Errors (404)
   - Location not found
   - Route not found
   
3. Rate Limit (429)
   - Too many requests
   
4. Server Errors (500)
   - Third-party API failures
   - Database connection issues
   - Unexpected exceptions
```

### Error Response Format

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": { /* optional */ }
  }
}
```

---

## Scalability Considerations

### Horizontal Scaling
- **Stateless Design**: No server-side sessions
- **Redis for State**: Shared cache across instances
- **Load Balancer Ready**: All endpoints idempotent (POST but safe to retry)

### Vertical Scaling
- **Async Operations**: Non-blocking I/O
- **Connection Pooling**: Reuse HTTP connections
- **Efficient Caching**: Reduces upstream API load

### Performance Optimizations
1. **Request Deduplication**: Prevent duplicate API calls
2. **Coordinate Normalization**: Maximize cache hits
3. **Tiered TTLs**: Balance freshness vs load
4. **Graceful Degradation**: Continue without cache if Redis fails

---

## Security

### Implemented Measures
- **Helmet**: Sets secure HTTP headers
- **CORS**: Restricts cross-origin requests
- **Rate Limiting**: Prevents abuse
- **Input Validation**: Zod schemas prevent injection
- **Error Sanitization**: Don't expose internal details

### Future Enhancements
- API key authentication
- User-based rate limiting
- Request signing
- IP allowlisting

---

## Monitoring & Observability

### Logging
- **Winston Logger**: Structured JSON logs
- **Levels**: error, warn, info, debug
- **Environments**:
  - Development: Colorized console
  - Production: JSON to files + console

### Metrics (Future)
- Request latency
- Cache hit rate
- Third-party API response times
- Error rates by type

### Health Checks
- `GET /api/health` - Overall system status
- `GET /api/health/cache` - Redis connection status

---

## Testing Strategy

### Unit Tests
- Service layer logic
- Scoring algorithm validation
- Utility functions

### Integration Tests
- API endpoint behavior
- Database interactions
- Cache operations

### End-to-End Tests
- Complete request flows
- Error scenarios
- Rate limiting

---

## Future Enhancements

### Short Term
1. **Better Timezone Handling**: Use `tz-lookup` library
2. **Historical Data Fallback**: Use alternative providers
3. **Sunset Photography Tips**: Based on score factors
4. **Weather Alerts**: Notify users of exceptional sunsets

### Medium Term
1. **Machine Learning**: Train model on user feedback
2. **Multi-Provider Fallbacks**: Increase reliability
3. **User Accounts**: Save favorite locations
4. **Webhook Support**: Push notifications

### Long Term
1. **Real-time Updates**: WebSocket for live conditions
2. **Computer Vision**: Analyze actual sunset photos
3. **Global Heatmap**: Visualize sunset quality worldwide
4. **API Monetization**: Premium tiers with more features

---

## Dependencies

### Production
- `express` - Web framework
- `redis` - Caching
- `axios` - HTTP client
- `winston` - Logging
- `zod` - Validation
- `suncalc` - Sunset time calculations
- `date-fns` - Date utilities

### Development
- `typescript` - Type safety
- `tsx` - Development runtime
- `jest` - Testing
- `eslint` - Code quality

---

## Deployment

### Prerequisites
- Node.js >= 18.0.0
- Redis server
- No external API keys required

### Steps
1. Clone repository
2. Install dependencies: `npm install`
3. Configure environment: Copy `.env.example` to `.env`
4. Build: `npm run build`
5. Start: `npm start`

### Docker (Future)
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist ./dist
CMD ["node", "dist/index.js"]
```

---

## License

MIT
