# JamBets — Live Data Design

## Overview

The live monitoring system polls verified sources every 15 minutes to retrieve current fixture statuses, live scores, and match events. It is the bridge between external reality and JamBets' settlement pipeline.

---

## Live Data Flow

```
[Scheduler triggers live monitor job — every 15 min]
        │
        ▼
[Query fixtures in active window]
  WHERE status IN ('scheduled', 'live')
  AND kickoff_at BETWEEN now()-3h AND now()+1h
        │
        ▼
[For each fixture:]
  │
  ├── [Get linked sources from football.fixture_sources]
  │
  ├── [Query each enabled source for current data]
  │     ├── Validate fixture identity (provider_event_id)
  │     ├── Fetch current status
  │     ├── Fetch current score (if live/finished)
  │     └── Fetch match events (goals, cards)
  │
  ├── [Cross-validate across sources]
  │     ├── Status agreement check
  │     ├── Score agreement check
  │     └── Flag conflicts if disagreement
  │
  ├── [Update football.fixtures]
  │     ├── status → 'live' or 'finished'
  │     └── updated_at → now()
  │
  ├── [Write to football.live_events]
  │     ├── Status change events
  │     ├── Goal events
  │     └── Other significant events
  │
  └── [If status='finished' → trigger result verification]
```

---

## Fixture Status Model

```
SCHEDULED ──▶ LIVE ──▶ FINISHED
    │                      │
    ├──▶ POSTPONED         ├──▶ (Result verification)
    └──▶ CANCELLED         └──▶ (Settlement)
```

### Status Definitions

| Status | Description | Settlement Impact |
|--------|-------------|-------------------|
| `scheduled` | Not yet started | Predictions active |
| `live` | Match in progress | Predictions locked (expired) |
| `finished` | Match completed | Eligible for result verification |
| `postponed` | Match postponed | Predictions voided |
| `cancelled` | Match cancelled | Predictions voided |

---

## Live Event Types

| Event Type | Data | Verified |
|------------|------|----------|
| `status_change` | {from, to, minute} | Requires 1 source |
| `goal` | {team, minute, player} | Requires 2 sources for score |
| `card` | {team, minute, player, type} | 1 source sufficient |
| `substitution` | {team, minute, player_in, player_out} | 1 source sufficient |

### Verification Requirements

- **Status changes:** 1 source sufficient (if source is high-priority)
- **Scores:** 2 agreeing sources required before updating canonical state
- **Match events (non-score):** 1 source sufficient, stored as informational

---

## Active Window

The live monitor only queries fixtures within the **active window**:

```
Active window = [now() - 3 hours, now() + 1 hour]
```

Rationale:
- **-3 hours:** Catches fixtures that started up to 3 hours ago (covers 90 min + extra time + delays)
- **+1 hour:** Pre-fetches status for fixtures about to kick off

Fixtures outside this window are not polled, reducing unnecessary API calls.

---

## Source-Specific Identity Validation

Before accepting data from a source, the monitor validates identity:

```
1. Look up football.fixture_sources for this fixture + source
2. Use stored provider_event_id to query the source
3. Verify returned data matches expected fixture:
   - Same teams (after normalization)
   - Same date (within tolerance)
4. If mismatch → reject data, log conflict
5. If match → accept and process
```

This prevents "drift" where a source's event ID starts pointing to a different match (e.g., after rescheduling).

---

## Conflict Detection

When sources disagree:

```python
def detect_conflicts(fixture_id, source_data: list[SourceUpdate]):
    """Check for disagreements between sources."""
    scores = [(s.source_id, s.home_score, s.away_score) for s in source_data]
    statuses = [(s.source_id, s.status) for s in source_data]

    # Score conflict: any two sources report different scores
    unique_scores = set((h, a) for _, h, a in scores)
    if len(unique_scores) > 1:
        create_data_conflict(
            fixture_id=fixture_id,
            conflict_type='score_mismatch',
            source_data=source_data
        )

    # Status conflict: sources disagree on match status
    unique_statuses = set(s for _, s in statuses)
    if len(unique_statuses) > 1:
        create_data_conflict(
            fixture_id=fixture_id,
            conflict_type='status_conflict',
            source_data=source_data
        )
```

Conflicts are logged but do **not** block the pipeline. The higher-priority source's data is used as provisional, and conflicts are surfaced for review.

---

## Rate Limiting

Each source has its own rate limit configuration. The live monitor respects these:

```
Per 15-minute cycle:
  - ESPN:           max 30 requests
  - LiveScore:      max 20 requests
  - Flashscore:     max 20 requests
  - API-Football:   max 60 requests (API tier dependent)
  - Football-Data:  max 10 requests (free tier)
```

If a cycle would exceed the rate limit, lower-priority fixtures are skipped (those furthest from kickoff).
