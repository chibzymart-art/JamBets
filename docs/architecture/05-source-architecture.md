# JamBets — Source Architecture

## Overview

The **Verified Source Registry** manages all external data providers. Every piece of data entering JamBets must come from a registered, enabled, and validated source.

---

## Source Registry Design

### Registry Table: `core.data_sources`

Each source is a row in the registry with:

- **Identity:** name, display_name, base_url
- **Capabilities:** supports_fixtures, supports_live, supports_results
- **Operational:** enabled, priority, reliability_score
- **Health:** last_success_at, last_failure_at, last_failure_reason
- **Config:** source-specific settings (rate limits, API keys reference, endpoints)

### Initial Sources

| Source | Type | Fixtures | Live | Results | Priority |
|--------|------|----------|------|---------|----------|
| ESPN | Scraper/API | ✅ | ✅ | ✅ | 10 |
| LiveScore | Scraper | ✅ | ✅ | ✅ | 20 |
| Flashscore | Scraper | ✅ | ✅ | ✅ | 30 |
| Football-Data.org | API | ✅ | ❌ | ✅ | 15 |
| API-Football | API | ✅ | ✅ | ✅ | 25 |

> **Note:** Not every source has identical coverage. Some may only provide fixtures and results but not live data. The registry tracks this explicitly.

---

## Source Adapter Pattern

Each source implements a common interface:

```python
class BaseSourceAdapter(ABC):
    """Abstract base for all data source adapters."""

    @abstractmethod
    def get_source_name(self) -> str: ...

    @abstractmethod
    async def fetch_fixtures(
        self, league_id: str, date_from: date, date_to: date
    ) -> list[RawFixture]: ...

    @abstractmethod
    async def fetch_live_status(
        self, provider_event_ids: list[str]
    ) -> list[RawLiveStatus]: ...

    @abstractmethod
    async def fetch_results(
        self, provider_event_ids: list[str]
    ) -> list[RawResult]: ...

    @abstractmethod
    def get_provider_event_id(self, raw_data: dict) -> str: ...
```

### Adapter Responsibilities

1. **HTTP communication** — handles authentication, rate limiting, retries
2. **Response parsing** — extracts structured data from HTML/JSON
3. **Provider ID extraction** — returns the source-specific event identifier
4. **Error handling** — raises typed exceptions for source-specific failures

### Adapter Limitations

Adapters do **NOT**:
- Validate fixture identity (that's the fixture engine's job)
- Write to Supabase (the orchestration layer does that)
- Make settlement decisions
- Cache data locally

---

## Source Health Monitoring

### Automatic Health Tracking

On every fetch attempt:

```
SUCCESS:
  → Update last_success_at = now()
  → Increment success counter (in reliability calculation)

FAILURE:
  → Update last_failure_at = now()
  → Update last_failure_reason = error detail
  → Increment failure counter
  → If consecutive_failures >= THRESHOLD → auto-disable source
  → Write audit_log entry
```

### Reliability Score Calculation

```
reliability_score = successes / (successes + failures)
```

Over a rolling 7-day window. Recalculated on each fetch cycle.

### Circuit Breaker

```
States:
  CLOSED   → Source is healthy, all requests proceed
  OPEN     → Source is failing, requests are skipped
  HALF-OPEN → After cooldown, one test request is attempted

Transitions:
  CLOSED → OPEN:     After 5 consecutive failures
  OPEN → HALF-OPEN:  After 10-minute cooldown
  HALF-OPEN → CLOSED: If test request succeeds
  HALF-OPEN → OPEN:   If test request fails
```

---

## Source Priority & Fallback

When multiple sources provide the same data:

1. Sources are queried in **priority order** (lower number = higher priority)
2. First successful response is used as primary
3. Additional sources are used for **cross-validation**
4. If primary source fails, next-priority source becomes primary

For result verification specifically:
- **Minimum 2 agreeing sources** required to mark a result as verified
- Disagreements are logged as `football.data_conflicts`

---

## Source Configuration

Source-specific configuration is stored in the `config` JSONB column:

```json
// ESPN example
{
  "rate_limit_rpm": 30,
  "retry_max": 3,
  "retry_backoff_base": 2,
  "timeout_seconds": 30,
  "endpoints": {
    "fixtures": "/sport/soccer/league/{league_id}/schedule",
    "live": "/sport/soccer/scoreboard",
    "results": "/sport/soccer/league/{league_id}/scores"
  }
}

// API-Football example
{
  "rate_limit_rpm": 60,
  "api_key_env_var": "API_FOOTBALL_KEY",
  "base_url": "https://v3.football.api-sports.io",
  "endpoints": {
    "fixtures": "/fixtures",
    "live": "/fixtures?live=all",
    "results": "/fixtures?status=FT"
  }
}
```

> **Security:** API keys are referenced by environment variable name, never stored in the database.
