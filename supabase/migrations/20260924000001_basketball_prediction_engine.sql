-- =====================================================================
-- Oddsbanta — Autonomous Basketball Prediction Engine (Phase 1 Migration)
-- Migration: 20260924000001_basketball_prediction_engine.sql
-- 
-- Strictly Isolated Tables & Entities:
-- 1. basketball_leagues: NBA, EuroLeague, NCAA Men, WNBA, Liga ACB, etc.
-- 2. basketball_teams: Team registry with Pace, ORtg, DRtg & Four Factors
-- 3. basketball_players: Key player registry with usage, PER & injury status
-- 4. basketball_fixtures: Match fixtures, period scores, fatigue & market odds
-- 5. basketball_predictions: 250,000 Monte Carlo simulations & confidence tiers
-- 6. basketball_settlements: Audit log for settlements & margin of victory
-- 7. basketball_predictions_paywall: Dynamic paywall redaction view
-- 
-- Invariant: Zero modification, references, or foreign keys to football/tennis tables.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. BASKETBALL LEAGUES
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.basketball_leagues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    country TEXT,
    quarter_minutes INTEGER NOT NULL DEFAULT 12,
    periods_count INTEGER NOT NULL DEFAULT 4,
    default_pace NUMERIC(5,2) DEFAULT 99.5,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_basketball_leagues_code ON public.basketball_leagues(code);
CREATE INDEX IF NOT EXISTS idx_basketball_leagues_active ON public.basketball_leagues(is_active);

-- ---------------------------------------------------------------------
-- 2. BASKETBALL TEAMS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.basketball_teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_name TEXT NOT NULL UNIQUE,
    short_name TEXT,
    league_id UUID NOT NULL REFERENCES public.basketball_leagues(id) ON DELETE CASCADE,
    conference TEXT,
    division TEXT,
    arena_name TEXT,
    city TEXT,
    state TEXT,
    altitude_ft INTEGER DEFAULT 0,
    offensive_rating NUMERIC(5,2) DEFAULT 112.0,
    defensive_rating NUMERIC(5,2) DEFAULT 112.0,
    net_rating NUMERIC(5,2) DEFAULT 0.0,
    pace NUMERIC(5,2) DEFAULT 99.5,
    four_factors JSONB DEFAULT '{"efg_pct": 0.535, "tov_pct": 0.125, "orb_pct": 0.250, "ftr": 0.220}'::jsonb,
    logo_url TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_basketball_teams_league ON public.basketball_teams(league_id);
CREATE INDEX IF NOT EXISTS idx_basketball_teams_conf ON public.basketball_teams(conference);

-- ---------------------------------------------------------------------
-- 3. BASKETBALL PLAYERS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.basketball_players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES public.basketball_teams(id) ON DELETE CASCADE,
    canonical_name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    jersey_number TEXT,
    position TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'questionable', 'doubtful', 'out', 'day_to_day')),
    usage_rate NUMERIC(4,1) DEFAULT 20.0,
    per_rating NUMERIC(4,1) DEFAULT 15.0,
    impact_rating NUMERIC(4,2) DEFAULT 0.0,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_basketball_player UNIQUE (team_id, canonical_name)
);

CREATE INDEX IF NOT EXISTS idx_basketball_players_team ON public.basketball_players(team_id);
CREATE INDEX IF NOT EXISTS idx_basketball_players_status ON public.basketball_players(status);

-- ---------------------------------------------------------------------
-- 4. BASKETBALL FIXTURES & LIVE SCORING
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.basketball_fixtures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_key TEXT UNIQUE NOT NULL, -- e.g. NBA:BOS-NYK:20261022
    league_id UUID NOT NULL REFERENCES public.basketball_leagues(id) ON DELETE CASCADE,
    home_team_id UUID NOT NULL REFERENCES public.basketball_teams(id) ON DELETE RESTRICT,
    away_team_id UUID NOT NULL REFERENCES public.basketball_teams(id) ON DELETE RESTRICT,
    target_kickoff_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'finished', 'cancelled', 'postponed')),
    home_score INTEGER DEFAULT 0,
    away_score INTEGER DEFAULT 0,
    period_scores JSONB DEFAULT '{"home": [], "away": []}'::jsonb,
    current_period TEXT,
    time_remaining TEXT,
    winner_id UUID REFERENCES public.basketball_teams(id) ON DELETE SET NULL,
    market_spread NUMERIC(4,1),
    market_total NUMERIC(5,1),
    home_moneyline_odds NUMERIC(5,2),
    away_moneyline_odds NUMERIC(5,2),
    home_rest_days INTEGER DEFAULT 1,
    away_rest_days INTEGER DEFAULT 1,
    is_home_b2b BOOLEAN DEFAULT false,
    is_away_b2b BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_basketball_fixtures_kickoff ON public.basketball_fixtures(target_kickoff_at ASC);
CREATE INDEX IF NOT EXISTS idx_basketball_fixtures_status ON public.basketball_fixtures(status);
CREATE INDEX IF NOT EXISTS idx_basketball_fixtures_league ON public.basketball_fixtures(league_id);
CREATE INDEX IF NOT EXISTS idx_basketball_fixtures_home ON public.basketball_fixtures(home_team_id);
CREATE INDEX IF NOT EXISTS idx_basketball_fixtures_away ON public.basketball_fixtures(away_team_id);

-- ---------------------------------------------------------------------
-- 5. BASKETBALL PREDICTIONS & 250,000 MONTE CARLO SIMULATIONS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.basketball_predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fixture_id UUID NOT NULL REFERENCES public.basketball_fixtures(id) ON DELETE CASCADE UNIQUE,
    market TEXT NOT NULL CHECK (market IN (
        'moneyline', 
        'point_spread', 
        'game_total_over_under', 
        'first_half_points', 
        'first_quarter_winner', 
        'team_total_over_under',
        'NO_SAFE_BANKER'
    )),
    prediction TEXT NOT NULL, -- e.g. 'Boston Celtics -5.5', 'Over 224.5 Points'
    probability NUMERIC(5,4) NOT NULL CHECK (probability >= 0.0000 AND probability <= 1.0000),
    confidence_category TEXT NOT NULL CHECK (confidence_category IN (
        'BANGER', 
        'TOP PICK', 
        'HIGH CONFIDENCE', 
        'MID CONFIDENCE', 
        'LOW CONFIDENCE', 
        'RISKY', 
        'NO_SAFE_BANKER'
    )),
    secondary_predictions JSONB DEFAULT '[]'::jsonb,
    simulations_count INTEGER NOT NULL DEFAULT 250000,
    simulated_home_score NUMERIC(5,1),
    simulated_away_score NUMERIC(5,1),
    edge_percentage NUMERIC(5,2),
    fair_odds NUMERIC(5,2),
    market_odds NUMERIC(5,2),
    tier_required TEXT NOT NULL DEFAULT 'free' CHECK (tier_required IN ('free', 'standard', 'bigbang', 'vip', 'admin')),
    publication_status TEXT NOT NULL DEFAULT 'published' CHECK (publication_status IN ('draft', 'published', 'archived')),
    target_kickoff_at TIMESTAMPTZ NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    settlement_status TEXT NOT NULL DEFAULT 'pending' CHECK (settlement_status IN ('pending', 'won', 'lost', 'void', 'half_won', 'half_lost')),
    settlement_notes TEXT,
    settled_at TIMESTAMPTZ,
    actual_result TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_basketball_predictions_fixture ON public.basketball_predictions(fixture_id);
CREATE INDEX IF NOT EXISTS idx_basketball_predictions_status ON public.basketball_predictions(settlement_status);
CREATE INDEX IF NOT EXISTS idx_basketball_predictions_kickoff ON public.basketball_predictions(target_kickoff_at ASC);
CREATE INDEX IF NOT EXISTS idx_basketball_predictions_tier ON public.basketball_predictions(confidence_category);
CREATE INDEX IF NOT EXISTS idx_basketball_predictions_pub ON public.basketball_predictions(publication_status);

-- ---------------------------------------------------------------------
-- 6. BASKETBALL SETTLEMENT AUDIT LOG
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.basketball_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prediction_id UUID NOT NULL REFERENCES public.basketball_predictions(id) ON DELETE CASCADE UNIQUE,
    fixture_id UUID NOT NULL REFERENCES public.basketball_fixtures(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('won', 'lost', 'void', 'half_won', 'half_lost')),
    final_home_score INTEGER NOT NULL,
    final_away_score INTEGER NOT NULL,
    score_margin INTEGER NOT NULL,
    total_points INTEGER NOT NULL,
    was_overtime BOOLEAN NOT NULL DEFAULT false,
    settlement_logic_version TEXT NOT NULL DEFAULT '1.0',
    notes TEXT,
    settled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_basketball_settlements_pred ON public.basketball_settlements(prediction_id);
CREATE INDEX IF NOT EXISTS idx_basketball_settlements_fix ON public.basketball_settlements(fixture_id);
CREATE INDEX IF NOT EXISTS idx_basketball_settlements_status ON public.basketball_settlements(status);

-- ---------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY (RLS) POLICIES
-- ---------------------------------------------------------------------
ALTER TABLE public.basketball_leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.basketball_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.basketball_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.basketball_fixtures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.basketball_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.basketball_settlements ENABLE ROW LEVEL SECURITY;

-- Leagues: Public read, Service Role write
DROP POLICY IF EXISTS "basketball_leagues_public_read" ON public.basketball_leagues;
CREATE POLICY "basketball_leagues_public_read" ON public.basketball_leagues
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "basketball_leagues_service_role_all" ON public.basketball_leagues;
CREATE POLICY "basketball_leagues_service_role_all" ON public.basketball_leagues
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Teams: Public read, Service Role write
DROP POLICY IF EXISTS "basketball_teams_public_read" ON public.basketball_teams;
CREATE POLICY "basketball_teams_public_read" ON public.basketball_teams
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "basketball_teams_service_role_all" ON public.basketball_teams;
CREATE POLICY "basketball_teams_service_role_all" ON public.basketball_teams
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Players: Public read, Service Role write
DROP POLICY IF EXISTS "basketball_players_public_read" ON public.basketball_players;
CREATE POLICY "basketball_players_public_read" ON public.basketball_players
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "basketball_players_service_role_all" ON public.basketball_players;
CREATE POLICY "basketball_players_service_role_all" ON public.basketball_players
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Fixtures: Public read, Service Role write
DROP POLICY IF EXISTS "basketball_fixtures_public_read" ON public.basketball_fixtures;
CREATE POLICY "basketball_fixtures_public_read" ON public.basketball_fixtures
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "basketball_fixtures_service_role_all" ON public.basketball_fixtures;
CREATE POLICY "basketball_fixtures_service_role_all" ON public.basketball_fixtures
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Predictions: Service Role full access
DROP POLICY IF EXISTS "basketball_predictions_service_role_all" ON public.basketball_predictions;
CREATE POLICY "basketball_predictions_service_role_all" ON public.basketball_predictions
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Predictions: Authenticated Paid / Admin full read access
DROP POLICY IF EXISTS "basketball_predictions_paid_read" ON public.basketball_predictions;
CREATE POLICY "basketball_predictions_paid_read" ON public.basketball_predictions
    FOR SELECT TO authenticated
    USING (
        public.is_admin() OR
        public.is_paid_subscriber() OR
        EXISTS (
            SELECT 1 FROM public.entitlements e
            WHERE e.user_id = auth.uid()
              AND e.tier IN ('standard', 'bigbang', 'pro', 'premium', 'vip', 'admin')
              AND (e.valid_until IS NULL OR e.valid_until > now())
        )
    );

-- Settlements: Public read audit log, Service Role write
DROP POLICY IF EXISTS "basketball_settlements_public_read" ON public.basketball_settlements;
CREATE POLICY "basketball_settlements_public_read" ON public.basketball_settlements
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "basketball_settlements_service_role_all" ON public.basketball_settlements;
CREATE POLICY "basketball_settlements_service_role_all" ON public.basketball_settlements
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------
-- 8. DYNAMIC PAYWALL VIEW (Field-Level Redaction)
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS public.basketball_predictions_paywall;
CREATE OR REPLACE VIEW public.basketball_predictions_paywall AS
SELECT
    p.id,
    p.fixture_id,
    p.market,
    CASE
        WHEN public.is_admin() THEN p.prediction
        WHEN public.is_paid_subscriber() THEN p.prediction
        WHEN p.settlement_status IN ('won', 'lost', 'void') THEN p.prediction
        WHEN f.status IN ('finished', 'cancelled', 'postponed') THEN p.prediction
        ELSE 'LOCKED'
    END AS prediction,
    CASE
        WHEN public.is_admin() THEN p.probability
        WHEN public.is_paid_subscriber() THEN p.probability
        WHEN p.settlement_status IN ('won', 'lost', 'void') THEN p.probability
        WHEN f.status IN ('finished', 'cancelled', 'postponed') THEN p.probability
        ELSE NULL
    END AS probability,
    CASE
        WHEN public.is_admin() THEN p.confidence_category
        WHEN public.is_paid_subscriber() THEN p.confidence_category
        WHEN p.settlement_status IN ('won', 'lost', 'void') THEN p.confidence_category
        WHEN f.status IN ('finished', 'cancelled', 'postponed') THEN p.confidence_category
        ELSE 'LOCKED'
    END AS confidence_category,
    CASE
        WHEN public.is_admin() THEN p.secondary_predictions
        WHEN public.is_paid_subscriber() THEN p.secondary_predictions
        WHEN p.settlement_status IN ('won', 'lost', 'void') THEN p.secondary_predictions
        WHEN f.status IN ('finished', 'cancelled', 'postponed') THEN p.secondary_predictions
        ELSE '[]'::jsonb
    END AS secondary_predictions,
    CASE
        WHEN public.is_admin() THEN p.metadata
        WHEN public.is_paid_subscriber() THEN p.metadata
        WHEN p.settlement_status IN ('won', 'lost', 'void') THEN p.metadata
        WHEN f.status IN ('finished', 'cancelled', 'postponed') THEN p.metadata
        ELSE '{}'::jsonb
    END AS metadata,
    p.simulations_count,
    p.simulated_home_score,
    p.simulated_away_score,
    p.edge_percentage,
    p.fair_odds,
    p.market_odds,
    p.tier_required,
    p.publication_status,
    p.target_kickoff_at,
    p.settlement_status,
    p.settlement_notes,
    p.settled_at,
    p.actual_result,
    p.created_at,
    p.updated_at,
    CASE
        WHEN public.is_admin() THEN false
        WHEN public.is_paid_subscriber() THEN false
        WHEN p.settlement_status IN ('won', 'lost', 'void') THEN false
        WHEN f.status IN ('finished', 'cancelled', 'postponed') THEN false
        ELSE true
    END AS is_locked
FROM public.basketball_predictions p
JOIN public.basketball_fixtures f ON f.id = p.fixture_id
WHERE p.publication_status = 'published';

-- Enable View security permissions
GRANT SELECT ON public.basketball_predictions_paywall TO anon, authenticated, service_role;
