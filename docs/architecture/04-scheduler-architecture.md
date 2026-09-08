# JamBets — Scheduler Architecture

## Overview

Two mandatory automated jobs power JamBets. Both are managed by **APScheduler** with a persistent job store, ensuring they survive application restarts and handle failures gracefully.

---

## Job 1: Prediction Scheduler

**Frequency:** Every 6 hours (00:00, 06:00, 12:00, 18:00 UTC)

### Flow

```
[APScheduler Trigger]
        │
        ▼
[Generate Idempotency Key]
  (e.g., "prediction-2026-09-08T06:00Z")
        │
        ▼
[Check: Already executed?] ──YES──▶ [SKIP — log and exit]
        │ NO
        ▼
[Record job_start in core.system_jobs]
        │
        ▼
[Query football.fixtures WHERE status='scheduled'
 AND kickoff_at BETWEEN now() AND now()+7days]
        │
        ▼
[For each eligible fixture:]
  ├── Fetch historical data from Supabase
  ├── Run prediction model
  ├── Execute 250,000 Monte Carlo simulations
  ├── Generate market predictions (1X2, O/U, BTTS, etc.)
  ├── Write to football.predictions
  ├── Write to football.prediction_markets
  └── Write to football.simulations
        │
        ▼
[Record job_complete in core.system_jobs]
        │
        ▼
[Write audit_log entry]
```

### Eligible Fixture Criteria

- Status = `scheduled`
- Kickoff between `now()` and `now() + 7 days`
- No existing prediction with same `model_version` for this fixture
- League is active and supported

### Idempotency

- Each job execution generates a key: `prediction-{ISO_TIMESTAMP}`
- Before processing, the job checks `core.system_jobs.idempotency_key`
- If key exists → job is skipped
- Each fixture prediction is also keyed by `(fixture_id, model_version)`

---

## Job 2: Live / Result / Settlement Scheduler

**Frequency:** Every 15 minutes

### Flow

```
[APScheduler Trigger]
        │
        ▼
[Generate Idempotency Key]
  (e.g., "live-2026-09-08T06:15Z")
        │
        ▼
[Check: Already executed?] ──YES──▶ [SKIP — log and exit]
        │ NO
        ▼
[Record job_start in core.system_jobs]
        │
        ▼
┌─── PHASE A: LIVE DATA ───────────────────────────┐
│                                                    │
│  [Query football.fixtures WHERE                    │
│   status IN ('scheduled', 'live')                  │
│   AND kickoff_at BETWEEN now()-3h AND now()+1h]    │
│           │                                        │
│           ▼                                        │
│  [For each fixture:]                               │
│    ├── Query enabled sources for this fixture      │
│    ├── Validate fixture identity per source         │
│    ├── Fetch current status & scores               │
│    ├── Write to football.live_events               │
│    └── Update football.fixtures.status             │
│                                                    │
└────────────────────────────────────────────────────┘
        │
        ▼
┌─── PHASE B: RESULT VERIFICATION ─────────────────┐
│                                                    │
│  [Query fixtures WHERE status='finished'           │
│   AND NOT EXISTS verified result]                  │
│           │                                        │
│           ▼                                        │
│  [For each fixture:]                               │
│    ├── Collect scores from all sources              │
│    ├── Write each to football.result_sources       │
│    ├── Check agreement (≥2 sources must agree)     │
│    ├── If agreed → write football.results           │
│    │   (status='verified')                         │
│    └── If disagreed → write football.data_conflicts│
│                                                    │
└────────────────────────────────────────────────────┘
        │
        ▼
┌─── PHASE C: SETTLEMENT ─────────────────────────┐
│                                                    │
│  [Query football.predictions WHERE                 │
│   status='published'                               │
│   AND fixture has verified result                  │
│   AND NOT EXISTS settlement for this prediction]   │
│           │                                        │
│           ▼                                        │
│  [For each prediction:]                            │
│    ├── Load verified result                        │
│    ├── For each market in prediction_markets:      │
│    │   ├── Evaluate outcome vs actual result       │
│    │   ├── Determine: won / lost / void / push     │
│    │   └── Write to football.settlements           │
│    ├── Update prediction status → 'settled'        │
│    └── Write audit_log entry                       │
│                                                    │
└────────────────────────────────────────────────────┘
        │
        ▼
[Record job_complete in core.system_jobs]
```

---

## Resilience Design

### Restart Survival

- APScheduler uses a **persistent job store** (SQLite or PostgreSQL)
- Jobs are registered at startup and survive process restarts
- Missed jobs are detected and executed on next startup

### Temporary Provider Outage

- Per-source circuit breaker pattern
- If a source fails, it is marked with `last_failure_at`
- Other sources continue operating
- Failed sources are retried on next cycle
- After N consecutive failures, source is auto-disabled with alert

### Temporary Network Outage

- Exponential backoff with jitter for HTTP requests
- Maximum 3 retries per source per cycle
- Job continues with remaining sources if some fail
- Partial results are valid — job records partial completion

### Missed Execution

- APScheduler `misfire_grace_time` = 900 seconds (15 min)
- If a prediction job is missed by <15 min → runs immediately
- If missed by >15 min → skipped, runs at next scheduled time
- Live/settlement job: short cycle (15 min) self-heals on next run

### Duplicate Execution

- Idempotency keys prevent double-processing
- Database UNIQUE constraints prevent duplicate records
- Settlement is single-evaluation per market (UNIQUE on market_id)

---

## Configuration

```python
# scheduler/config.py

SCHEDULER_CONFIG = {
    "prediction": {
        "trigger": "cron",
        "hour": "0,6,12,18",
        "timezone": "UTC",
        "misfire_grace_time": 900,
        "max_instances": 1,
        "coalesce": True,
    },
    "live_result_settlement": {
        "trigger": "interval",
        "minutes": 15,
        "timezone": "UTC",
        "misfire_grace_time": 900,
        "max_instances": 1,
        "coalesce": True,
    },
}
```
