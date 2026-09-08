# JamBets — Failure & Recovery Strategy

## Design Philosophy

JamBets is designed to **degrade gracefully** rather than fail catastrophically. Every component assumes that failures will occur and has a defined recovery path.

---

## Failure Categories

### 1. Source Provider Failures

| Failure | Impact | Recovery |
|---------|--------|----------|
| Source HTTP 5xx | No data from that source | Retry with backoff → circuit breaker → use other sources |
| Source HTTP 429 (rate limited) | Throttled | Backoff → retry next cycle |
| Source HTML structure changed | Parsing failure | Mark source as failing → alert → manual adapter fix |
| Source permanently down | No data from that source | Disable source → other sources continue |
| All sources down | No new data | Skip cycle → retry next cycle → alert admin |

### 2. Network Failures

| Failure | Impact | Recovery |
|---------|--------|----------|
| DNS resolution failure | Can't reach source | Retry with exponential backoff (3 attempts) |
| Connection timeout | Slow/dead source | 30-second timeout → circuit breaker |
| SSL/TLS error | Can't establish secure connection | Log + skip source → alert |

### 3. Database Failures

| Failure | Impact | Recovery |
|---------|--------|----------|
| Supabase temporary outage | Can't read/write | Retry with backoff → hold in memory → retry |
| Supabase connection pool exhausted | Blocked queries | Connection pool with max_size + overflow |
| Write conflict (unique violation) | Duplicate data | Idempotent operations → upsert pattern |
| Migration failure | Schema inconsistency | Rollback migration → fix → re-apply |

### 4. Scheduler Failures

| Failure | Impact | Recovery |
|---------|--------|----------|
| Process crash | Jobs stop running | Restart process → APScheduler persistent store → missed job recovery |
| Missed job execution | Data gap | `misfire_grace_time` → run on next opportunity |
| Duplicate job execution | Double processing | Idempotency key check → skip if already done |
| Job hangs (infinite loop) | Blocks next execution | `max_instances=1` → timeout → kill → alert |

### 5. Prediction/Simulation Failures

| Failure | Impact | Recovery |
|---------|--------|----------|
| Insufficient historical data | Can't model | Skip fixture → log reason → retry when more data available |
| NumPy computation error | Bad simulation | Catch exception → skip fixture → log |
| Invalid λ parameters (negative/NaN) | Invalid prediction | Validate before simulation → reject invalid → log |
| Out of memory | Process crash | Sequential processing → memory limits → restart |

### 6. Settlement Failures

| Failure | Impact | Recovery |
|---------|--------|----------|
| Unverified result | Can't settle | Skip → retry next cycle (result may get verified) |
| Market evaluation error | Partial settlement | Atomic transaction → rollback on error → retry |
| Concurrent settlement attempt | Double settlement | UNIQUE constraint → second attempt fails safely |

---

## Recovery Patterns

### Exponential Backoff with Jitter

```python
def backoff_delay(attempt: int, base: float = 1.0, max_delay: float = 60.0) -> float:
    delay = min(base * (2 ** attempt), max_delay)
    jitter = random.uniform(0, delay * 0.1)
    return delay + jitter
```

### Circuit Breaker

```
CLOSED ──[5 failures]──▶ OPEN ──[10 min cooldown]──▶ HALF-OPEN
                            ▲                              │
                            │                              │
                            └──[test fails]────────────────┘
                                                           │
                                              [test passes]│
                                                           ▼
                                                        CLOSED
```

### Idempotent Job Execution

```python
def execute_job(job_type: str, timestamp: datetime):
    idempotency_key = f"{job_type}-{timestamp.isoformat()}"

    # Check if already executed
    existing = db.query(system_jobs, idempotency_key=idempotency_key)
    if existing:
        log.info(f"Job {idempotency_key} already executed, skipping")
        return

    # Record job start
    job = db.insert(system_jobs, {
        "job_type": job_type,
        "idempotency_key": idempotency_key,
        "status": "running",
        "started_at": now()
    })

    try:
        # Execute job logic
        result = run_job_logic(job_type)
        db.update(job, status="completed", completed_at=now())
    except Exception as e:
        db.update(job, status="failed", error_message=str(e))
        raise
```

### Atomic Transactions

Settlement writes use database transactions:

```python
async def settle_prediction(prediction_id, result_id):
    async with db.transaction():
        # All writes succeed or all fail
        for market in prediction.markets:
            outcome = evaluate_market(market, result)
            db.insert(settlements, {
                "market_id": market.id,
                "result_id": result_id,
                "outcome": outcome
            })
        db.update(prediction, status="settled")
```

---

## Monitoring & Alerting

### Health Checks

| Check | Frequency | Alert Threshold |
|-------|-----------|----------------|
| Scheduler heartbeat | Every 5 min | Missing for 15 min |
| Source health | Every 15 min | Reliability < 0.50 |
| Prediction freshness | Every 6 hours | No predictions in 12 hours |
| Settlement lag | Every 15 min | Unsettled results older than 2 hours |
| Job failure rate | Every 15 min | > 3 consecutive failures |

### Alert Channels

- Audit logs in `core.audit_logs`
- Admin dashboard notifications
- Email alerts for critical failures (future enhancement)

---

## Data Integrity Guarantees

| Guarantee | Mechanism |
|-----------|-----------|
| No invented results | Settlement requires verified result status |
| No duplicate predictions | UNIQUE on (fixture_id, model_version) |
| No duplicate settlements | UNIQUE on (market_id) |
| No orphaned records | Foreign key constraints |
| Audit trail | Every write operation logged |
| Conflict visibility | All disagreements recorded in data_conflicts |
