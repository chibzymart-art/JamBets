# JamBets — Settlement Design

## Core Principle

> **NO VERIFIED DATA = NO SETTLEMENT**

This is an absolute, non-negotiable rule. The settlement engine will **never**:

- Invent scores
- Estimate scores
- Infer results from model predictions
- Use stale or cached results
- Use mock or hardcoded data
- Use a single unverified source
- Settle based on live events that haven't been finalized

---

## Settlement Flow

```
[Scheduler triggers settlement — every 15 minutes]
        │
        ▼
[Query eligible predictions]
  WHERE prediction.status = 'published'
  AND fixture.status = 'finished'
  AND EXISTS verified result (football.results WHERE status='verified')
  AND NOT EXISTS settlement for this prediction
        │
        ▼
[For each eligible prediction:]
  │
  ├── [Load verified result]
  │     ├── Confirm result.status = 'verified'
  │     ├── Confirm verification_sources ≥ 2
  │     └── Confirm result was not disputed since last check
  │
  ├── [For each market in prediction_markets:]
  │     │
  │     ├── [Evaluate market against result]
  │     │     ├── 1X2: compare predicted outcome vs actual result
  │     │     ├── O/U: compare total goals vs line
  │     │     ├── BTTS: check both teams scored
  │     │     ├── Correct Score: exact match check
  │     │     └── etc.
  │     │
  │     ├── [Determine outcome]
  │     │     ├── WON:  prediction matches result
  │     │     ├── LOST: prediction does not match result
  │     │     ├── VOID: fixture postponed/cancelled
  │     │     └── PUSH: exact line match (e.g., O/U 2.5 with exactly 2.5 — N/A for 0.5 lines)
  │     │
  │     └── [Write to football.settlements]
  │
  ├── [Update prediction.status → 'settled']
  │
  └── [Write audit_log entry]
```

---

## Market Settlement Rules

### 1X2 (Match Result)

| Predicted | Home > Away | Home = Away | Away > Home |
|-----------|------------|------------|------------|
| `home` | **WON** | LOST | LOST |
| `draw` | LOST | **WON** | LOST |
| `away` | LOST | LOST | **WON** |

### Over/Under

| Predicted | Total > Line | Total = Line | Total < Line |
|-----------|-------------|-------------|-------------|
| `over` | **WON** | PUSH | LOST |
| `under` | LOST | PUSH | **WON** |

> For half-goal lines (2.5, 1.5, etc.), PUSH is impossible.

### Both Teams to Score

| Predicted | Home > 0 AND Away > 0 | Otherwise |
|-----------|----------------------|-----------|
| `yes` | **WON** | LOST |
| `no` | LOST | **WON** |

### Correct Score

| Predicted | Exact Match | Otherwise |
|-----------|------------|-----------|
| `2-1` | **WON** | LOST |

### Double Chance

| Predicted | Home Win | Draw | Away Win |
|-----------|---------|------|---------|
| `home_draw` | **WON** | **WON** | LOST |
| `away_draw` | LOST | **WON** | **WON** |
| `home_away` | **WON** | LOST | **WON** |

---

## Void Conditions

A market is voided (outcome = `void`) when:

- Fixture status is `postponed` or `cancelled`
- Result has been disputed and no resolution exists
- Data conflict exists with no resolution

Voided settlements:
- Are recorded in `football.settlements` with outcome `void`
- Are excluded from user win/loss statistics
- Generate an audit log entry

---

## Settlement Idempotency

- Each market can only be settled **once** (UNIQUE constraint on `market_id`)
- Re-running the settlement job on an already-settled prediction is a no-op
- If a result is later corrected (extremely rare):
  - Admin manually creates a `result_correction` audit entry
  - Existing settlements are voided
  - New settlements are created against the corrected result

---

## Settlement Audit Trail

Every settlement action produces an audit record:

```json
{
  "action": "settlement.executed",
  "resource_type": "prediction",
  "resource_id": "pred-uuid",
  "details": {
    "fixture_id": "fix-uuid",
    "result_id": "res-uuid",
    "markets_settled": 6,
    "outcomes": {
      "won": 3,
      "lost": 2,
      "void": 1
    },
    "verification_sources": 3,
    "model_version": "v1.0.0"
  }
}
```

---

## Safety Guards

| Guard | Description |
|-------|-------------|
| Verified result required | Result must have status='verified' |
| Minimum sources | ≥2 sources must agree on final score |
| No prediction results | Model output is NEVER used as actual result |
| No stale data | Result must be from current fixture (checked by fixture_id FK) |
| Single settlement | UNIQUE constraint prevents double settlement |
| Audit trail | Every settlement is logged for forensic review |
| Admin override | Only admins can void/re-settle with justification |
