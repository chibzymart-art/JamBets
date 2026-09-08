# JamBets — Data Flow

## Conceptual Data Flow

This is the end-to-end data flow through JamBets. The UI **never** consumes scraper output directly. All data passes through Supabase.

```
VERIFIED EXTERNAL SOURCES
(ESPN, LiveScore, Flashscore, Football APIs)
              │
              ▼
    PYTHON DATA ACQUISITION
    (Source adapters, HTTP clients,
     rate limiting, retry logic)
              │
              ▼
       SOURCE VALIDATION
       (Verify source is registered,
        enabled, and trustworthy)
              │
              ▼
   FIXTURE IDENTITY VALIDATION
   (Canonical key generation,
    team/league name resolution,
    deduplication)
              │
              ▼
        NORMALIZATION
        (Standardize team names,
         league names, timezones,
         data formats)
              │
              ▼
       CLOUD SUPABASE
       (football.fixtures,
        football.fixture_sources,
        football.teams,
        football.leagues)
              │
              ▼
  FOOTBALL PREDICTION ENGINE
  (Statistical modeling,
   feature extraction,
   λ parameter calculation)
              │
              ▼
  PER-FIXTURE 250,000 SIMULATIONS
  (Monte Carlo via NumPy,
   probability distributions,
   market derivation)
              │
              ▼
       CLOUD SUPABASE
       (football.predictions,
        football.prediction_markets,
        football.simulations)
              │
              ▼
    PYTHON LIVE/RESULT MONITOR
    (Poll sources every 15 min,
     cross-validate status/scores)
              │
              ▼
     VERIFIED LIVE/FINAL DATA
     (≥2 sources must agree,
      conflicts flagged)
              │
              ▼
       SETTLEMENT ENGINE
       (Market-by-market evaluation,
        won/lost/void/push,
        NO VERIFIED DATA = NO SETTLEMENT)
              │
              ▼
       CLOUD SUPABASE
       (football.results,
        football.result_sources,
        football.settlements,
        football.data_conflicts)
              │
              ▼
          WEB UI
          (Next.js reads from Supabase
           via authenticated API routes)
```

---

## Key Boundaries

### Boundary 1: External Sources → Python

- Only Python workers communicate with external sources
- Next.js (web) **never** calls external data sources
- Data enters the system only through registered source adapters

### Boundary 2: Python → Supabase

- Python workers write to Supabase using the service-role key
- All writes go through the Supabase client (not raw SQL)
- No local file storage — Supabase is the only persistence layer

### Boundary 3: Supabase → Web UI

- Web UI reads from Supabase via API routes
- API routes use the service-role key server-side
- Client-side uses the anon key with RLS enforcement
- **The UI never receives raw scraper data**

### Boundary 4: Predictions → Settlements

- Predictions are **never** used as actual results
- Settlement requires independently verified results
- The prediction engine and settlement engine are completely separate

---

## Data Flow Timing

| Stage | Trigger | Frequency |
|-------|---------|-----------|
| Fixture discovery | Prediction scheduler | Every 6 hours |
| Prediction + simulation | Prediction scheduler | Every 6 hours |
| Live status polling | Live monitor scheduler | Every 15 minutes |
| Result verification | Live monitor scheduler | Every 15 minutes |
| Settlement | Live monitor scheduler | Every 15 minutes |
| UI data refresh | User request / polling | On-demand |
