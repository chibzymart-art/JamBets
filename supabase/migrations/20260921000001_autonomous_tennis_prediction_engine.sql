-- =====================================================================
-- Oddsbanta — Autonomous Tennis Prediction Engine (Phase 1 Migration)
-- Migration: 20260921000001_autonomous_tennis_prediction_engine.sql
-- 
-- Strictly Isolated Tables & Entities:
-- 1. tennis_tournaments: ATP, WTA, Grand Slam, Challenger competitions
-- 2. tennis_players: Player registry with surface-specific ELO ratings
-- 3. tennis_fixtures: Match fixtures, schedules, and live/final scores
-- 4. tennis_predictions: Hierarchical Markov predictions & confidence tiers
-- 5. tennis_settlements: Audit log for settlements & edge-case handling (RET/WO)
-- 6. tennis_predictions_paywall: Dynamic paywall redaction view
-- 
-- Invariant: Zero modification, references, or foreign keys to football tables.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TENNIS TOURNAMENTS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tennis_tournaments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    tour TEXT NOT NULL CHECK (tour IN ('ATP', 'WTA', 'GRAND_SLAM', 'CHALLENGER', 'ITF')),
    category TEXT NOT NULL CHECK (category IN ('GS', '1000', '500', '250', 'CH', 'ITF')),
    surface TEXT NOT NULL CHECK (surface IN ('hard_outdoor', 'hard_indoor', 'clay', 'grass', 'carpet')),
    court_pace_index NUMERIC(4,1) DEFAULT 35.0, -- CPI (Court Pace Index: 20-29 Slow, 30-34 Med-Slow, 35-39 Med, 40-44 Med-Fast, 45+ Fast)
    country TEXT,
    city TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tennis_tournaments_tour ON public.tennis_tournaments(tour);
CREATE INDEX IF NOT EXISTS idx_tennis_tournaments_surface ON public.tennis_tournaments(surface);
CREATE INDEX IF NOT EXISTS idx_tennis_tournaments_category ON public.tennis_tournaments(category);

-- ---------------------------------------------------------------------
-- 2. TENNIS PLAYERS & SURFACE-SPECIFIC ELO
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tennis_players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    country TEXT,
    handedness TEXT NOT NULL DEFAULT 'R' CHECK (handedness IN ('R', 'L', 'U')),
    backhand_type TEXT NOT NULL DEFAULT 'two_handed' CHECK (backhand_type IN ('one_handed', 'two_handed', 'unknown')),
    height_cm INTEGER,
    current_rank INTEGER,
    hard_elo NUMERIC(6,1) NOT NULL DEFAULT 1500.0,
    clay_elo NUMERIC(6,1) NOT NULL DEFAULT 1500.0,
    grass_elo NUMERIC(6,1) NOT NULL DEFAULT 1500.0,
    indoor_elo NUMERIC(6,1) NOT NULL DEFAULT 1500.0,
    metadata JSONB DEFAULT '{}'::jsonb, -- Hold serve/return rolling stats & dominance metrics
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tennis_players_rank ON public.tennis_players(current_rank);
CREATE INDEX IF NOT EXISTS idx_tennis_players_hard_elo ON public.tennis_players(hard_elo DESC);
CREATE INDEX IF NOT EXISTS idx_tennis_players_clay_elo ON public.tennis_players(clay_elo DESC);
CREATE INDEX IF NOT EXISTS idx_tennis_players_grass_elo ON public.tennis_players(grass_elo DESC);

-- ---------------------------------------------------------------------
-- 3. TENNIS FIXTURES & LIVE SCORING
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tennis_fixtures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_key TEXT UNIQUE NOT NULL, -- e.g. ATP:MADRID:ALCARAZ-SINNER:20260925
    tournament_id UUID NOT NULL REFERENCES public.tennis_tournaments(id) ON DELETE CASCADE,
    round TEXT NOT NULL DEFAULT 'R32', -- F, SF, QF, R16, R32, R64, R128, QUAL
    player1_id UUID NOT NULL REFERENCES public.tennis_players(id) ON DELETE RESTRICT,
    player2_id UUID NOT NULL REFERENCES public.tennis_players(id) ON DELETE RESTRICT,
    best_of_sets INTEGER NOT NULL DEFAULT 3 CHECK (best_of_sets IN (3, 5)),
    target_kickoff_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'finished', 'cancelled', 'postponed', 'walkover', 'retired')),
    score_p1_sets INTEGER DEFAULT 0,
    score_p2_sets INTEGER DEFAULT 0,
    set_scores TEXT[] DEFAULT '{}', -- e.g. ['6-4', '3-6', '7-6(5)']
    current_game_score TEXT, -- e.g. '40-30', 'A-40'
    server_indicator INTEGER DEFAULT 1 CHECK (server_indicator IN (1, 2)),
    winner_id UUID REFERENCES public.tennis_players(id) ON DELETE SET NULL,
    retired_player_id UUID REFERENCES public.tennis_players(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}'::jsonb, -- CPI, temperature, weather, match duration minutes
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tennis_fixtures_kickoff ON public.tennis_fixtures(target_kickoff_at ASC);
CREATE INDEX IF NOT EXISTS idx_tennis_fixtures_status ON public.tennis_fixtures(status);
CREATE INDEX IF NOT EXISTS idx_tennis_fixtures_tournament ON public.tennis_fixtures(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tennis_fixtures_p1 ON public.tennis_fixtures(player1_id);
CREATE INDEX IF NOT EXISTS idx_tennis_fixtures_p2 ON public.tennis_fixtures(player2_id);

-- ---------------------------------------------------------------------
-- 4. TENNIS PREDICTIONS & MARKOV TIERS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tennis_predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fixture_id UUID NOT NULL REFERENCES public.tennis_fixtures(id) ON DELETE CASCADE UNIQUE,
    market TEXT NOT NULL CHECK (market IN (
        'match_winner', 
        'set_handicap', 
        'game_handicap', 
        'total_games_over_under', 
        'first_set_winner', 
        'correct_set_score',
        'NO_SAFE_BANKER'
    )),
    prediction TEXT NOT NULL, -- e.g. 'Player 1 Win', 'Over 21.5 Games', 'Player 2 +1.5 Sets'
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
    tier_required TEXT NOT NULL DEFAULT 'free' CHECK (tier_required IN ('free', 'standard', 'bigbang', 'vip', 'admin')),
    publication_status TEXT NOT NULL DEFAULT 'published' CHECK (publication_status IN ('draft', 'published', 'archived')),
    target_kickoff_at TIMESTAMPTZ NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb, -- Hold Markov Hold/Break rates, Dominance Ratio, H2H, AI tactical analysis
    settlement_status TEXT NOT NULL DEFAULT 'pending' CHECK (settlement_status IN ('pending', 'won', 'lost', 'void', 'half_won', 'half_lost')),
    settlement_notes TEXT,
    settled_at TIMESTAMPTZ,
    actual_result TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tennis_predictions_fixture ON public.tennis_predictions(fixture_id);
CREATE INDEX IF NOT EXISTS idx_tennis_predictions_status ON public.tennis_predictions(settlement_status);
CREATE INDEX IF NOT EXISTS idx_tennis_predictions_kickoff ON public.tennis_predictions(target_kickoff_at ASC);
CREATE INDEX IF NOT EXISTS idx_tennis_predictions_tier ON public.tennis_predictions(confidence_category);
CREATE INDEX IF NOT EXISTS idx_tennis_predictions_pub ON public.tennis_predictions(publication_status);

-- ---------------------------------------------------------------------
-- 5. TENNIS SETTLEMENT AUDIT LOG
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tennis_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prediction_id UUID NOT NULL REFERENCES public.tennis_predictions(id) ON DELETE CASCADE UNIQUE,
    fixture_id UUID NOT NULL REFERENCES public.tennis_fixtures(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('won', 'lost', 'void', 'half_won', 'half_lost')),
    p1_sets INTEGER DEFAULT 0,
    p2_sets INTEGER DEFAULT 0,
    total_games INTEGER DEFAULT 0,
    was_retired BOOLEAN NOT NULL DEFAULT false,
    was_walkover BOOLEAN NOT NULL DEFAULT false,
    settlement_logic_version TEXT NOT NULL DEFAULT '1.0',
    notes TEXT,
    settled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tennis_settlements_pred ON public.tennis_settlements(prediction_id);
CREATE INDEX IF NOT EXISTS idx_tennis_settlements_fix ON public.tennis_settlements(fixture_id);
CREATE INDEX IF NOT EXISTS idx_tennis_settlements_status ON public.tennis_settlements(status);

-- ---------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY (RLS) POLICIES
-- ---------------------------------------------------------------------
ALTER TABLE public.tennis_tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tennis_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tennis_fixtures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tennis_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tennis_settlements ENABLE ROW LEVEL SECURITY;

-- Tournaments: Public read, Service Role write
DROP POLICY IF EXISTS "tennis_tournaments_public_read" ON public.tennis_tournaments;
CREATE POLICY "tennis_tournaments_public_read" ON public.tennis_tournaments
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "tennis_tournaments_service_role_all" ON public.tennis_tournaments;
CREATE POLICY "tennis_tournaments_service_role_all" ON public.tennis_tournaments
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Players: Public read, Service Role write
DROP POLICY IF EXISTS "tennis_players_public_read" ON public.tennis_players;
CREATE POLICY "tennis_players_public_read" ON public.tennis_players
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "tennis_players_service_role_all" ON public.tennis_players;
CREATE POLICY "tennis_players_service_role_all" ON public.tennis_players
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Fixtures: Public read, Service Role write
DROP POLICY IF EXISTS "tennis_fixtures_public_read" ON public.tennis_fixtures;
CREATE POLICY "tennis_fixtures_public_read" ON public.tennis_fixtures
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "tennis_fixtures_service_role_all" ON public.tennis_fixtures;
CREATE POLICY "tennis_fixtures_service_role_all" ON public.tennis_fixtures
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Predictions: Service Role full access
DROP POLICY IF EXISTS "tennis_predictions_service_role_all" ON public.tennis_predictions;
CREATE POLICY "tennis_predictions_service_role_all" ON public.tennis_predictions
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Predictions: Authenticated Paid / Admin full read access
DROP POLICY IF EXISTS "tennis_predictions_paid_read" ON public.tennis_predictions;
CREATE POLICY "tennis_predictions_paid_read" ON public.tennis_predictions
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
DROP POLICY IF EXISTS "tennis_settlements_public_read" ON public.tennis_settlements;
CREATE POLICY "tennis_settlements_public_read" ON public.tennis_settlements
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "tennis_settlements_service_role_all" ON public.tennis_settlements;
CREATE POLICY "tennis_settlements_service_role_all" ON public.tennis_settlements
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------
-- 7. DYNAMIC PAYWALL VIEW (Field-Level Redaction)
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS public.tennis_predictions_paywall;
CREATE OR REPLACE VIEW public.tennis_predictions_paywall AS
SELECT
    p.id,
    p.fixture_id,
    p.market,
    CASE
        WHEN public.is_admin() THEN p.prediction
        WHEN public.is_paid_subscriber() THEN p.prediction
        WHEN p.settlement_status IN ('won', 'lost', 'void') THEN p.prediction
        WHEN f.status IN ('finished', 'retired', 'walkover') THEN p.prediction
        ELSE 'LOCKED'
    END AS prediction,
    CASE
        WHEN public.is_admin() THEN p.probability
        WHEN public.is_paid_subscriber() THEN p.probability
        WHEN p.settlement_status IN ('won', 'lost', 'void') THEN p.probability
        WHEN f.status IN ('finished', 'retired', 'walkover') THEN p.probability
        ELSE NULL
    END AS probability,
    CASE
        WHEN public.is_admin() THEN p.confidence_category
        WHEN public.is_paid_subscriber() THEN p.confidence_category
        WHEN p.settlement_status IN ('won', 'lost', 'void') THEN p.confidence_category
        WHEN f.status IN ('finished', 'retired', 'walkover') THEN p.confidence_category
        ELSE 'LOCKED'
    END AS confidence_category,
    CASE
        WHEN public.is_admin() THEN p.secondary_predictions
        WHEN public.is_paid_subscriber() THEN p.secondary_predictions
        WHEN p.settlement_status IN ('won', 'lost', 'void') THEN p.secondary_predictions
        WHEN f.status IN ('finished', 'retired', 'walkover') THEN p.secondary_predictions
        ELSE '[]'::jsonb
    END AS secondary_predictions,
    CASE
        WHEN public.is_admin() THEN p.metadata
        WHEN public.is_paid_subscriber() THEN p.metadata
        WHEN p.settlement_status IN ('won', 'lost', 'void') THEN p.metadata
        WHEN f.status IN ('finished', 'retired', 'walkover') THEN p.metadata
        ELSE '{}'::jsonb
    END AS metadata,
    p.simulations_count,
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
        WHEN f.status IN ('finished', 'retired', 'walkover') THEN false
        ELSE true
    END AS is_locked
FROM public.tennis_predictions p
JOIN public.tennis_fixtures f ON f.id = p.fixture_id
WHERE p.publication_status = 'published';

-- Enable View security permissions
GRANT SELECT ON public.tennis_predictions_paywall TO anon, authenticated, service_role;
