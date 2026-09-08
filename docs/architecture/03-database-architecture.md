# JamBets — Database Architecture

## Overview

All data is persisted in **Cloud Supabase (PostgreSQL)**. The database is the single source of truth. The UI reads only from Supabase. Python workers write only to Supabase.

---

## Schema: `core`

### `core.users`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | User ID (matches Supabase Auth) |
| email | TEXT | NOT NULL, UNIQUE | User email |
| display_name | TEXT | | Display name |
| role | TEXT | NOT NULL, DEFAULT 'free' | 'free', 'pro', 'premium', 'admin' |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Account creation |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Last update |

### `core.subscriptions`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Subscription ID |
| user_id | UUID | FK → core.users(id) | Owner |
| stripe_subscription_id | TEXT | UNIQUE | Stripe subscription reference |
| tier | TEXT | NOT NULL | 'free', 'pro', 'premium' |
| status | TEXT | NOT NULL | 'active', 'past_due', 'cancelled', 'trialing' |
| current_period_start | TIMESTAMPTZ | | Billing period start |
| current_period_end | TIMESTAMPTZ | | Billing period end |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

### `core.payments`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Payment ID |
| user_id | UUID | FK → core.users(id) | Payer |
| stripe_payment_id | TEXT | UNIQUE | Stripe payment intent ID |
| amount_cents | INTEGER | NOT NULL | Amount in cents |
| currency | TEXT | NOT NULL, DEFAULT 'usd' | ISO currency code |
| status | TEXT | NOT NULL | 'succeeded', 'failed', 'refunded' |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

### `core.entitlements`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Entitlement ID |
| user_id | UUID | FK → core.users(id), UNIQUE | One active entitlement per user |
| tier | TEXT | NOT NULL | Resolved access tier |
| features | JSONB | NOT NULL, DEFAULT '{}' | Feature flags |
| valid_until | TIMESTAMPTZ | | Entitlement expiry |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

### `core.data_sources`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Source ID |
| name | TEXT | NOT NULL, UNIQUE | e.g., 'espn', 'livescore' |
| display_name | TEXT | NOT NULL | Human-readable name |
| base_url | TEXT | | Source base URL |
| source_type | TEXT | NOT NULL | 'scraper', 'api' |
| supports_fixtures | BOOLEAN | NOT NULL, DEFAULT false | |
| supports_live | BOOLEAN | NOT NULL, DEFAULT false | |
| supports_results | BOOLEAN | NOT NULL, DEFAULT false | |
| priority | INTEGER | NOT NULL, DEFAULT 100 | Lower = higher priority |
| enabled | BOOLEAN | NOT NULL, DEFAULT true | |
| reliability_score | DECIMAL(3,2) | DEFAULT 1.00 | 0.00 to 1.00 |
| last_success_at | TIMESTAMPTZ | | Last successful fetch |
| last_failure_at | TIMESTAMPTZ | | Last failed fetch |
| last_failure_reason | TEXT | | Failure detail |
| config | JSONB | DEFAULT '{}' | Source-specific config |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

### `core.system_jobs`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Job execution ID |
| job_type | TEXT | NOT NULL | 'prediction', 'live_monitor', 'settlement' |
| status | TEXT | NOT NULL | 'running', 'completed', 'failed', 'skipped' |
| started_at | TIMESTAMPTZ | NOT NULL | |
| completed_at | TIMESTAMPTZ | | |
| items_processed | INTEGER | DEFAULT 0 | |
| items_failed | INTEGER | DEFAULT 0 | |
| error_message | TEXT | | |
| metadata | JSONB | DEFAULT '{}' | |
| idempotency_key | TEXT | UNIQUE | Prevents duplicate execution |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

### `core.audit_logs`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Log entry ID |
| actor_type | TEXT | NOT NULL | 'user', 'system', 'scheduler' |
| actor_id | TEXT | | User ID or job ID |
| action | TEXT | NOT NULL | e.g., 'settlement.executed', 'source.disabled' |
| resource_type | TEXT | | e.g., 'fixture', 'prediction' |
| resource_id | TEXT | | Resource identifier |
| details | JSONB | DEFAULT '{}' | Action-specific details |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

---

## Schema: `football`

### `football.leagues`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | League ID |
| name | TEXT | NOT NULL | Canonical league name |
| country | TEXT | NOT NULL | Country code |
| tier | INTEGER | DEFAULT 1 | League tier (1 = top flight) |
| season | TEXT | | e.g., '2026-27' |
| active | BOOLEAN | NOT NULL, DEFAULT true | |
| metadata | JSONB | DEFAULT '{}' | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

### `football.teams`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Team ID |
| canonical_name | TEXT | NOT NULL, UNIQUE | Normalized team name |
| display_name | TEXT | NOT NULL | Display name |
| short_name | TEXT | | Abbreviation |
| country | TEXT | | |
| league_id | UUID | FK → football.leagues(id) | Primary league |
| logo_url | TEXT | | |
| aliases | JSONB | DEFAULT '[]' | Known alternative names |
| metadata | JSONB | DEFAULT '{}' | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

### `football.fixtures`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Canonical fixture ID |
| league_id | UUID | FK → football.leagues(id) | League |
| home_team_id | UUID | FK → football.teams(id) | Home team |
| away_team_id | UUID | FK → football.teams(id) | Away team |
| kickoff_at | TIMESTAMPTZ | NOT NULL | Scheduled kickoff |
| status | TEXT | NOT NULL, DEFAULT 'scheduled' | 'scheduled','live','finished','postponed','cancelled' |
| matchday | INTEGER | | Matchday/round number |
| venue | TEXT | | Stadium name |
| canonical_key | TEXT | NOT NULL, UNIQUE | Dedup key: league+home+away+date |
| metadata | JSONB | DEFAULT '{}' | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

### `football.fixture_sources`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| fixture_id | UUID | FK → football.fixtures(id) | Canonical fixture |
| source_id | UUID | FK → core.data_sources(id) | Data source |
| provider_event_id | TEXT | NOT NULL | Source-specific event ID |
| provider_data | JSONB | DEFAULT '{}' | Raw provider response |
| match_confidence | DECIMAL(3,2) | | How confident the match is |
| last_fetched_at | TIMESTAMPTZ | | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |
| UNIQUE(source_id, provider_event_id) | | | One mapping per source per event |

### `football.predictions`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Prediction ID |
| fixture_id | UUID | FK → football.fixtures(id) | Target fixture |
| model_version | TEXT | NOT NULL | Model identifier |
| confidence_score | DECIMAL(5,4) | | Overall confidence |
| simulation_count | INTEGER | NOT NULL, DEFAULT 250000 | Simulations run |
| status | TEXT | NOT NULL, DEFAULT 'pending' | 'pending','published','expired','settled' |
| generated_at | TIMESTAMPTZ | NOT NULL | When prediction was made |
| expires_at | TIMESTAMPTZ | | Prediction expiry (kickoff time) |
| job_id | UUID | FK → core.system_jobs(id) | Originating job |
| metadata | JSONB | DEFAULT '{}' | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

### `football.prediction_markets`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Market ID |
| prediction_id | UUID | FK → football.predictions(id) | Parent prediction |
| market_type | TEXT | NOT NULL | '1x2','over_under_2.5','btts','correct_score',etc |
| market_params | JSONB | DEFAULT '{}' | e.g., {"line": 2.5} |
| predicted_outcome | TEXT | NOT NULL | e.g., 'home', 'over', 'yes' |
| probability | DECIMAL(5,4) | NOT NULL | 0.0000 to 1.0000 |
| implied_odds | DECIMAL(8,2) | | 1/probability |
| edge | DECIMAL(5,4) | | Edge vs. market odds |
| tier_required | TEXT | NOT NULL, DEFAULT 'free' | 'free','pro','premium' |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

### `football.simulations`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Simulation batch ID |
| prediction_id | UUID | FK → football.predictions(id) | Parent prediction |
| fixture_id | UUID | FK → football.fixtures(id) | Target fixture |
| simulation_count | INTEGER | NOT NULL | Number of sims in this batch |
| home_goals_distribution | JSONB | NOT NULL | {0: count, 1: count, ...} |
| away_goals_distribution | JSONB | NOT NULL | {0: count, 1: count, ...} |
| scoreline_matrix | JSONB | NOT NULL | {"0-0": count, "1-0": count, ...} |
| summary_stats | JSONB | NOT NULL | Mean, median, std for each team |
| duration_ms | INTEGER | | Computation time |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

### `football.live_events`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Event ID |
| fixture_id | UUID | FK → football.fixtures(id) | Fixture |
| source_id | UUID | FK → core.data_sources(id) | Reporting source |
| event_type | TEXT | NOT NULL | 'status_change','goal','card','substitution' |
| minute | INTEGER | | Match minute |
| data | JSONB | NOT NULL | Event details |
| verified | BOOLEAN | NOT NULL, DEFAULT false | Cross-source verified |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

### `football.results`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Result ID |
| fixture_id | UUID | FK → football.fixtures(id), UNIQUE | One result per fixture |
| home_score | INTEGER | NOT NULL | Final home score |
| away_score | INTEGER | NOT NULL | Final away score |
| status | TEXT | NOT NULL | 'verified','pending','disputed' |
| verified_at | TIMESTAMPTZ | | When result was verified |
| verification_sources | INTEGER | NOT NULL, DEFAULT 0 | Number of agreeing sources |
| metadata | JSONB | DEFAULT '{}' | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

### `football.result_sources`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| result_id | UUID | FK → football.results(id) | Result |
| source_id | UUID | FK → core.data_sources(id) | Reporting source |
| home_score | INTEGER | NOT NULL | Score reported by this source |
| away_score | INTEGER | NOT NULL | Score reported by this source |
| reported_at | TIMESTAMPTZ | NOT NULL | When source reported |
| agrees_with_canonical | BOOLEAN | | Matches accepted result |
| raw_data | JSONB | DEFAULT '{}' | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |
| UNIQUE(result_id, source_id) | | | One report per source per result |

### `football.settlements`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Settlement ID |
| prediction_id | UUID | FK → football.predictions(id) | Prediction |
| market_id | UUID | FK → football.prediction_markets(id) | Specific market |
| result_id | UUID | FK → football.results(id) | Verified result |
| outcome | TEXT | NOT NULL | 'won','lost','void','push' |
| settled_at | TIMESTAMPTZ | NOT NULL | |
| settled_by | TEXT | NOT NULL, DEFAULT 'system' | 'system' or admin user ID |
| notes | TEXT | | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |
| UNIQUE(market_id) | | | One settlement per market |

### `football.data_conflicts`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Conflict ID |
| fixture_id | UUID | FK → football.fixtures(id) | Affected fixture |
| conflict_type | TEXT | NOT NULL | 'score_mismatch','identity_conflict','status_conflict' |
| source_a_id | UUID | FK → core.data_sources(id) | First source |
| source_b_id | UUID | FK → core.data_sources(id) | Second source |
| source_a_data | JSONB | NOT NULL | Data from source A |
| source_b_data | JSONB | NOT NULL | Data from source B |
| resolution | TEXT | DEFAULT 'unresolved' | 'unresolved','resolved_a','resolved_b','manual' |
| resolved_by | TEXT | | Admin user ID or 'system' |
| resolved_at | TIMESTAMPTZ | | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

---

## Row-Level Security (RLS) Policy Summary

| Table | Policy | Description |
|-------|--------|-------------|
| core.users | SELECT own row | Users can only read their own profile |
| core.subscriptions | SELECT own | Users can only see their own subscription |
| core.payments | SELECT own | Users can only see their own payments |
| football.predictions | SELECT based on tier | Gated by entitlement tier |
| football.prediction_markets | SELECT based on tier | Markets gated by tier_required |
| football.fixtures | SELECT all | Public read access |
| football.results | SELECT all | Public read access |
| football.settlements | SELECT own predictions | Via prediction ownership |
| core.system_jobs | SELECT admin only | Admin access only |
| core.audit_logs | SELECT admin only | Admin access only |

---

## Indexes (Critical)

```sql
-- Fixture lookup
CREATE INDEX idx_fixtures_kickoff ON football.fixtures(kickoff_at);
CREATE INDEX idx_fixtures_status ON football.fixtures(status);
CREATE INDEX idx_fixtures_league ON football.fixtures(league_id);
CREATE INDEX idx_fixtures_canonical ON football.fixtures(canonical_key);

-- Prediction lookup
CREATE INDEX idx_predictions_fixture ON football.predictions(fixture_id);
CREATE INDEX idx_predictions_status ON football.predictions(status);

-- Settlement lookup
CREATE INDEX idx_settlements_prediction ON football.settlements(prediction_id);
CREATE INDEX idx_settlements_outcome ON football.settlements(outcome);

-- Source tracking
CREATE INDEX idx_fixture_sources_fixture ON football.fixture_sources(fixture_id);
CREATE INDEX idx_result_sources_result ON football.result_sources(result_id);

-- Job tracking
CREATE INDEX idx_system_jobs_type ON core.system_jobs(job_type);
CREATE INDEX idx_system_jobs_idempotency ON core.system_jobs(idempotency_key);
```
