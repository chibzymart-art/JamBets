# JamBets — Fixture Identity Design

## Problem

Different data sources use different identifiers, team names, and league names for the same fixture. JamBets must resolve all of these into a single **canonical fixture** to prevent duplicate predictions, conflicting results, and settlement errors.

---

## Canonical Fixture Key

Every fixture is uniquely identified by a **canonical key**:

```
canonical_key = f"{league_canonical}:{home_canonical}:{away_canonical}:{date_YYYYMMDD}"
```

Example:
```
eng-premier-league:arsenal:manchester-city:20260915
```

### Key Components

| Component | Source | Normalization |
|-----------|--------|---------------|
| League | Normalized from provider name | Slug: lowercase, hyphens, no special chars |
| Home team | Normalized from provider name | Canonical name from `football.teams` |
| Away team | Normalized from provider name | Canonical name from `football.teams` |
| Date | Kickoff date in UTC | Format: YYYYMMDD |

---

## Team Name Resolution

### Problem

The same team has different names across sources:

| Source | Name |
|--------|------|
| ESPN | "Man City" |
| LiveScore | "Manchester City" |
| Flashscore | "Manchester C." |
| API-Football | "Manchester City FC" |

### Solution: Alias Registry

Each team has a `canonical_name` and an `aliases` array:

```json
{
  "canonical_name": "manchester-city",
  "display_name": "Manchester City",
  "aliases": [
    "Man City",
    "Manchester C.",
    "Manchester City FC",
    "Man. City",
    "MCFC"
  ]
}
```

### Resolution Algorithm

```
1. Receive provider team name (e.g., "Man City")
2. Normalize: lowercase, strip whitespace, remove accents
3. Exact match against canonical_name → found? use it
4. Exact match against aliases → found? use canonical_name
5. Fuzzy match (Levenshtein distance ≤ 2) → found? use canonical_name
6. No match → flag as UNKNOWN, log for manual review
   → Do NOT create prediction for unresolved fixtures
```

---

## League Name Resolution

Same pattern as team resolution:

```json
{
  "canonical_name": "eng-premier-league",
  "display_name": "Premier League",
  "country": "ENG",
  "aliases": [
    "English Premier League",
    "EPL",
    "Barclays Premier League",
    "Premier League (England)"
  ]
}
```

---

## Fixture Matching Flow

```
[Source provides raw fixture data]
        │
        ▼
[Resolve league name → canonical league]
        │ FAIL → log unknown league, skip fixture
        ▼
[Resolve home team → canonical home team]
        │ FAIL → log unknown team, skip fixture
        ▼
[Resolve away team → canonical away team]
        │ FAIL → log unknown team, skip fixture
        ▼
[Normalize kickoff time to UTC date]
        │
        ▼
[Generate canonical_key]
        │
        ▼
[Check football.fixtures for existing canonical_key]
        │
    ┌───┴───┐
    │ EXISTS│ NEW
    │       │
    ▼       ▼
[Link source  [Create new
 in fixture_   fixture +
 sources]      link source]
        │
        ▼
[Store provider_event_id in football.fixture_sources]
```

---

## Cross-Source Validation

When multiple sources report the same fixture:

1. **Kickoff time tolerance:** ±30 minutes (sources may disagree on exact minute)
2. **Team identity must match exactly** after normalization
3. **Match confidence score** is calculated:
   - Same canonical key = 1.00
   - Same teams + date but different kickoff time within tolerance = 0.90
   - Fuzzy team match = 0.70 (flagged for review)

---

## Identity Conflicts

When sources disagree on fixture details:

```
Conflict types:
  - TEAM_MISMATCH:   Sources disagree on team identity
  - TIME_MISMATCH:   Kickoff times differ by >30 minutes
  - LEAGUE_MISMATCH: Sources disagree on league
  - STATUS_CONFLICT: Sources disagree on fixture status

Resolution:
  - Logged in football.data_conflicts
  - Higher-priority source wins by default
  - Manual override available for admin
  - Conflicted fixtures are EXCLUDED from prediction until resolved
```
