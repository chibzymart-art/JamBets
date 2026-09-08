# JamBets — Prediction Design

## Overview

The football prediction engine generates market predictions for upcoming fixtures. It operates exclusively within the **football domain** and is designed as a self-contained module.

---

## Prediction Pipeline

```
[Scheduler triggers prediction job]
        │
        ▼
[Query eligible fixtures from Supabase]
  (status='scheduled', kickoff within 7 days, no existing prediction)
        │
        ▼
[For each fixture:]
  │
  ├── [Load historical data]
  │     ├── Team form (last 10 matches)
  │     ├── Head-to-head records
  │     ├── Home/away performance
  │     ├── League standings
  │     └── Goals scored/conceded averages
  │
  ├── [Run prediction model]
  │     ├── Calculate expected goals (xG) per team
  │     ├── Adjust for home advantage
  │     ├── Adjust for form differential
  │     └── Output: λ_home, λ_away (Poisson parameters)
  │
  ├── [Delegate to simulation engine]
  │     └── 250,000 Monte Carlo simulations
  │
  ├── [Generate market predictions]
  │     ├── 1X2 (Match result)
  │     ├── Over/Under 2.5 goals
  │     ├── Both Teams to Score (BTTS)
  │     ├── Correct Score
  │     ├── Double Chance
  │     ├── Over/Under 1.5, 3.5 goals
  │     └── (extensible to more markets)
  │
  └── [Write to Supabase]
        ├── football.predictions
        ├── football.prediction_markets
        └── football.simulations
```

---

## Prediction Model

### Core Model: Bivariate Poisson

The base model uses independent Poisson distributions for home and away goals:

```
Home goals ~ Poisson(λ_home)
Away goals ~ Poisson(λ_away)
```

Where:
- `λ_home` = home team's attack strength × away team's defense weakness × home advantage factor
- `λ_away` = away team's attack strength × home team's defense weakness

### Input Features

| Feature | Source | Weight |
|---------|--------|--------|
| Average goals scored (home) | Last 10 home matches | High |
| Average goals scored (away) | Last 10 away matches | High |
| Average goals conceded (home) | Last 10 home matches | High |
| Average goals conceded (away) | Last 10 away matches | High |
| League average goals | Current season | Medium |
| Head-to-head goals | Last 5 meetings | Low |
| Recent form (points per game) | Last 5 matches | Medium |
| Home advantage multiplier | League-specific constant | Medium |

### Confidence Score

Each prediction receives a confidence score (0.0000 to 1.0000):

```
confidence = f(
  data_completeness,   # % of features available
  model_agreement,     # Model vs simulation alignment
  form_stability,      # Variance in recent performance
  sample_size          # Number of historical matches available
)
```

Predictions with confidence < 0.30 are generated but **not published** to users.

---

## Market Definitions

### Supported Markets

| Market | Code | Parameters | Outcome Values |
|--------|------|------------|----------------|
| Match Result | `1x2` | — | home, draw, away |
| Over/Under | `over_under` | line (e.g., 2.5) | over, under |
| Both Teams Score | `btts` | — | yes, no |
| Correct Score | `correct_score` | — | "2-1", "0-0", etc. |
| Double Chance | `double_chance` | — | home_draw, away_draw, home_away |
| Half-Time Result | `ht_result` | — | home, draw, away |

### Market Probability Derivation

All market probabilities are derived from the 250,000 simulation results:

```
P(home_win)  = count(home_score > away_score) / 250000
P(draw)      = count(home_score == away_score) / 250000
P(away_win)  = count(away_score > home_score) / 250000

P(over_2.5)  = count(home_score + away_score > 2) / 250000
P(btts_yes)  = count(home_score > 0 AND away_score > 0) / 250000

P(score_2_1) = count(home_score == 2 AND away_score == 1) / 250000
```

### Tier Gating

| Tier | Markets Available |
|------|-------------------|
| Free | 1X2, Over/Under 2.5 |
| Pro | All above + BTTS, Double Chance, O/U 1.5/3.5 |
| Premium | All above + Correct Score, HT Result |

---

## Prediction Lifecycle

```
PENDING → PUBLISHED → EXPIRED → SETTLED

PENDING:    Generated but below confidence threshold or awaiting review
PUBLISHED:  Available to users (confidence ≥ 0.30)
EXPIRED:    Fixture has kicked off (prediction window closed)
SETTLED:    Result verified and settlement applied
```

---

## Model Versioning

Every prediction records its `model_version` string:

```
Format: "v{major}.{minor}.{patch}"
Example: "v1.0.0"
```

This enables:
- A/B testing of model improvements
- Historical performance tracking per model version
- Preventing duplicate predictions (same fixture + same model version)
