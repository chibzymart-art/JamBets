-- =====================================================================
-- JamBets — Phase 1: Cloud Supabase Foundation Schema
-- Authoritative Production DDL
-- =====================================================================

-- Enable pgcrypto for UUID generation if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================================
-- 1. CORE DOMAIN TABLES
-- =====================================================================

-- 1.1 users
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'free' CHECK (role IN ('free', 'pro', 'premium', 'admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.2 subscriptions
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    stripe_subscription_id TEXT UNIQUE,
    tier TEXT NOT NULL CHECK (tier IN ('free', 'pro', 'premium')),
    status TEXT NOT NULL CHECK (status IN ('active', 'past_due', 'cancelled', 'trialing', 'incomplete', 'unpaid')),
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.3 payments
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    stripe_payment_id TEXT UNIQUE,
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    currency TEXT NOT NULL DEFAULT 'usd',
    status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'refunded', 'pending')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.4 entitlements
CREATE TABLE IF NOT EXISTS public.entitlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
    tier TEXT NOT NULL CHECK (tier IN ('free', 'pro', 'premium')),
    features JSONB NOT NULL DEFAULT '{}'::jsonb,
    valid_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.5 data_sources (Verified Source Registry)
CREATE TABLE IF NOT EXISTS public.data_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    base_url TEXT,
    source_type TEXT NOT NULL CHECK (source_type IN ('scraper', 'api')),
    supports_fixtures BOOLEAN NOT NULL DEFAULT false,
    supports_live BOOLEAN NOT NULL DEFAULT false,
    supports_results BOOLEAN NOT NULL DEFAULT false,
    priority INTEGER NOT NULL DEFAULT 100,
    enabled BOOLEAN NOT NULL DEFAULT true,
    reliability_score DECIMAL(3,2) DEFAULT 1.00 CHECK (reliability_score >= 0.00 AND reliability_score <= 1.00),
    last_success_at TIMESTAMPTZ,
    last_failure_at TIMESTAMPTZ,
    last_failure_reason TEXT,
    config JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.6 system_jobs
CREATE TABLE IF NOT EXISTS public.system_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type TEXT NOT NULL CHECK (job_type IN ('prediction_worker', 'live_monitor', 'result_verification', 'settlement_engine', 'source_health_check')),
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'skipped')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    items_processed INTEGER DEFAULT 0,
    items_failed INTEGER DEFAULT 0,
    error_message TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    idempotency_key TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.7 audit_logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'system', 'scheduler', 'admin')),
    actor_id TEXT,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- 2. FOOTBALL DOMAIN TABLES
-- =====================================================================

-- 2.1 football_leagues
CREATE TABLE IF NOT EXISTS public.football_leagues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    canonical_slug TEXT NOT NULL UNIQUE,
    country TEXT NOT NULL,
    tier INTEGER DEFAULT 1,
    season TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.2 football_teams
CREATE TABLE IF NOT EXISTS public.football_teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    short_name TEXT,
    country TEXT,
    league_id UUID REFERENCES public.football_leagues(id) ON DELETE SET NULL,
    logo_url TEXT,
    aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.3 football_fixtures
CREATE TABLE IF NOT EXISTS public.football_fixtures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id UUID NOT NULL REFERENCES public.football_leagues(id) ON DELETE CASCADE,
    home_team_id UUID NOT NULL REFERENCES public.football_teams(id) ON DELETE RESTRICT,
    away_team_id UUID NOT NULL REFERENCES public.football_teams(id) ON DELETE RESTRICT,
    kickoff_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'finished', 'postponed', 'cancelled', 'interrupted', 'suspended')),
    matchday INTEGER,
    venue TEXT,
    canonical_key TEXT NOT NULL UNIQUE,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT check_different_teams CHECK (home_team_id != away_team_id)
);

-- 2.4 football_fixture_sources (Fixture Provenance)
CREATE TABLE IF NOT EXISTS public.football_fixture_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fixture_id UUID NOT NULL REFERENCES public.football_fixtures(id) ON DELETE CASCADE,
    source_id UUID NOT NULL REFERENCES public.data_sources(id) ON DELETE CASCADE,
    provider_event_id TEXT NOT NULL,
    provider_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    retrieval_time TIMESTAMPTZ NOT NULL DEFAULT now(),
    verification_status TEXT NOT NULL DEFAULT 'verified' CHECK (verification_status IN ('pending', 'verified', 'disputed', 'rejected')),
    match_confidence DECIMAL(3,2) DEFAULT 1.00 CHECK (match_confidence >= 0.00 AND match_confidence <= 1.00),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(source_id, provider_event_id)
);

-- 2.5 football_simulations (Simulation Records: 250,000 Target)
CREATE TABLE IF NOT EXISTS public.football_simulations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fixture_id UUID NOT NULL REFERENCES public.football_fixtures(id) ON DELETE CASCADE,
    simulation_run_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    target_simulations INTEGER NOT NULL DEFAULT 250000 CHECK (target_simulations = 250000),
    completed_simulations INTEGER NOT NULL DEFAULT 0 CHECK (completed_simulations >= 0),
    start_time TIMESTAMPTZ NOT NULL DEFAULT now(),
    completion_time TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    home_goals_distribution JSONB DEFAULT '{}'::jsonb,
    away_goals_distribution JSONB DEFAULT '{}'::jsonb,
    scoreline_matrix JSONB DEFAULT '{}'::jsonb,
    summary_stats JSONB DEFAULT '{}'::jsonb,
    duration_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.6 football_predictions (Four-Day Rule & Prediction Storage)
CREATE TABLE IF NOT EXISTS public.football_predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fixture_id UUID NOT NULL REFERENCES public.football_fixtures(id) ON DELETE CASCADE,
    simulation_run_id UUID REFERENCES public.football_simulations(simulation_run_id) ON DELETE SET NULL,
    market TEXT NOT NULL CHECK (market IN ('1x2', 'over_under_1.5', 'over_under_2.5', 'over_under_3.5', 'btts', 'correct_score', 'double_chance', 'ht_result')),
    prediction TEXT NOT NULL,
    probability DECIMAL(5,4) NOT NULL CHECK (probability >= 0.0000 AND probability <= 1.0000),
    confidence_category TEXT NOT NULL CHECK (confidence_category IN ('low', 'medium', 'high', 'very_high')),
    publication_status TEXT NOT NULL DEFAULT 'draft' CHECK (publication_status IN ('draft', 'published', 'rejected', 'expired', 'settled')),
    tier_required TEXT NOT NULL DEFAULT 'free' CHECK (tier_required IN ('free', 'pro', 'premium')),
    source_data_version TEXT NOT NULL DEFAULT 'v1.0.0',
    metadata JSONB DEFAULT '{}'::jsonb,
    target_kickoff_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Enforce: Do not publish probabilities below 45%
    CONSTRAINT check_min_published_probability CHECK (publication_status != 'published' OR probability >= 0.4500),
    -- Enforce Four-Day Rule: Kickoff cannot be beyond 4 days from creation (+ 2 hour buffer for timezone/scheduling leeway)
    CONSTRAINT check_four_day_window CHECK (target_kickoff_at <= created_at + INTERVAL '4 days 2 hours')
);

-- 2.7 football_prediction_markets (Detailed Market Outcome Distributions)
CREATE TABLE IF NOT EXISTS public.football_prediction_markets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prediction_id UUID NOT NULL REFERENCES public.football_predictions(id) ON DELETE CASCADE,
    outcome TEXT NOT NULL,
    probability DECIMAL(5,4) NOT NULL CHECK (probability >= 0.0000 AND probability <= 1.0000),
    implied_odds DECIMAL(8,2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.8 football_live_events (Live Monitoring Provenance)
CREATE TABLE IF NOT EXISTS public.football_live_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fixture_id UUID NOT NULL REFERENCES public.football_fixtures(id) ON DELETE CASCADE,
    source_id UUID NOT NULL REFERENCES public.data_sources(id) ON DELETE CASCADE,
    provider_event_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('status_change', 'goal', 'card', 'substitution', 'var_decision', 'period_start', 'period_end')),
    minute INTEGER,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'disputed')),
    retrieval_time TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.9 football_results (Final Verified Result - Real Data Principle)
CREATE TABLE IF NOT EXISTS public.football_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fixture_id UUID NOT NULL UNIQUE REFERENCES public.football_fixtures(id) ON DELETE CASCADE,
    home_score INTEGER NOT NULL CHECK (home_score >= 0),
    away_score INTEGER NOT NULL CHECK (away_score >= 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'disputed')),
    verification_timestamp TIMESTAMPTZ,
    agreeing_sources_count INTEGER NOT NULL DEFAULT 0 CHECK (agreeing_sources_count >= 0),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Real Data Principle: To be 'verified', must have verification timestamp and at least 2 agreeing sources
    CONSTRAINT check_verified_has_min_sources CHECK (status != 'verified' OR (verification_timestamp IS NOT NULL AND agreeing_sources_count >= 2))
);

-- 2.10 football_result_sources (Result Provenance)
CREATE TABLE IF NOT EXISTS public.football_result_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    result_id UUID NOT NULL REFERENCES public.football_results(id) ON DELETE CASCADE,
    source_id UUID NOT NULL REFERENCES public.data_sources(id) ON DELETE CASCADE,
    provider_event_id TEXT NOT NULL,
    home_score INTEGER NOT NULL CHECK (home_score >= 0),
    away_score INTEGER NOT NULL CHECK (away_score >= 0),
    retrieval_time TIMESTAMPTZ NOT NULL DEFAULT now(),
    agrees_with_canonical BOOLEAN,
    raw_data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(result_id, source_id)
);

-- 2.11 football_settlements (Settlement Storage)
CREATE TABLE IF NOT EXISTS public.football_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prediction_id UUID NOT NULL REFERENCES public.football_predictions(id) ON DELETE CASCADE,
    result_id UUID REFERENCES public.football_results(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'won', 'lost', 'voided', 'conflict', 'verification_required')),
    result_source TEXT,
    provider_event_id TEXT,
    verification_timestamp TIMESTAMPTZ,
    actual_score TEXT,
    settlement_timestamp TIMESTAMPTZ,
    settled_by TEXT NOT NULL DEFAULT 'system',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(prediction_id)
);

-- 2.12 football_data_conflicts
CREATE TABLE IF NOT EXISTS public.football_data_conflicts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fixture_id UUID NOT NULL REFERENCES public.football_fixtures(id) ON DELETE CASCADE,
    conflict_type TEXT NOT NULL CHECK (conflict_type IN ('score_mismatch', 'identity_conflict', 'status_conflict', 'kickoff_time_conflict')),
    source_a_id UUID NOT NULL REFERENCES public.data_sources(id) ON DELETE CASCADE,
    source_b_id UUID NOT NULL REFERENCES public.data_sources(id) ON DELETE CASCADE,
    source_a_data JSONB NOT NULL,
    source_b_data JSONB NOT NULL,
    resolution TEXT NOT NULL DEFAULT 'unresolved' CHECK (resolution IN ('unresolved', 'resolved_a', 'resolved_b', 'manual_override', 'voided')),
    resolved_by TEXT,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- 3. INDEXES FOR HIGH-PERFORMANCE QUERYING
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON public.subscriptions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_entitlements_user ON public.entitlements(user_id);
CREATE INDEX IF NOT EXISTS idx_data_sources_enabled_priority ON public.data_sources(enabled, priority);
CREATE INDEX IF NOT EXISTS idx_system_jobs_type_status ON public.system_jobs(job_type, status);
CREATE INDEX IF NOT EXISTS idx_system_jobs_idempotency ON public.system_jobs(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON public.audit_logs(resource_type, resource_id);

CREATE INDEX IF NOT EXISTS idx_football_fixtures_kickoff ON public.football_fixtures(kickoff_at);
CREATE INDEX IF NOT EXISTS idx_football_fixtures_status ON public.football_fixtures(status);
CREATE INDEX IF NOT EXISTS idx_football_fixtures_canonical ON public.football_fixtures(canonical_key);
CREATE INDEX IF NOT EXISTS idx_football_fixtures_teams ON public.football_fixtures(home_team_id, away_team_id);
CREATE INDEX IF NOT EXISTS idx_fixture_sources_prov ON public.football_fixture_sources(source_id, provider_event_id);
CREATE INDEX IF NOT EXISTS idx_simulations_fixture ON public.football_simulations(fixture_id);
CREATE INDEX IF NOT EXISTS idx_simulations_run_id ON public.football_simulations(simulation_run_id);
CREATE INDEX IF NOT EXISTS idx_predictions_fixture_status ON public.football_predictions(fixture_id, publication_status);
CREATE INDEX IF NOT EXISTS idx_predictions_tier ON public.football_predictions(tier_required);
CREATE INDEX IF NOT EXISTS idx_live_events_fixture ON public.football_live_events(fixture_id, minute);
CREATE INDEX IF NOT EXISTS idx_results_fixture ON public.football_results(fixture_id);
CREATE INDEX IF NOT EXISTS idx_settlements_prediction ON public.football_settlements(prediction_id);
CREATE INDEX IF NOT EXISTS idx_settlements_status ON public.football_settlements(status);
CREATE INDEX IF NOT EXISTS idx_data_conflicts_fixture ON public.football_data_conflicts(fixture_id, resolution);

-- =====================================================================
-- 4. ROW-LEVEL SECURITY (RLS) POLICIES
-- =====================================================================

-- Enable RLS across all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.football_leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.football_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.football_fixtures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.football_fixture_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.football_simulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.football_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.football_prediction_markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.football_live_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.football_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.football_result_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.football_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.football_data_conflicts ENABLE ROW LEVEL SECURITY;

-- 4.1 Users table policies
CREATE POLICY "users_select_own" ON public.users
    FOR SELECT USING (auth.uid() = id);
CREATE POLICY "users_update_own" ON public.users
    FOR UPDATE USING (auth.uid() = id);

-- 4.2 Subscriptions policies
CREATE POLICY "subscriptions_select_own" ON public.subscriptions
    FOR SELECT USING (auth.uid() = user_id);

-- 4.3 Payments policies
CREATE POLICY "payments_select_own" ON public.payments
    FOR SELECT USING (auth.uid() = user_id);

-- 4.4 Entitlements policies
CREATE POLICY "entitlements_select_own" ON public.entitlements
    FOR SELECT USING (auth.uid() = user_id);

-- 4.5 Data sources policies (Public can see enabled sources)
CREATE POLICY "data_sources_public_read" ON public.data_sources
    FOR SELECT USING (enabled = true);

-- 4.6 Public Football reference data
CREATE POLICY "football_leagues_public_read" ON public.football_leagues
    FOR SELECT USING (true);
CREATE POLICY "football_teams_public_read" ON public.football_teams
    FOR SELECT USING (true);
CREATE POLICY "football_fixtures_public_read" ON public.football_fixtures
    FOR SELECT USING (true);
CREATE POLICY "football_results_public_read" ON public.football_results
    FOR SELECT USING (true);
CREATE POLICY "football_live_events_public_read" ON public.football_live_events
    FOR SELECT USING (true);

-- 4.7 Predictions gated by tier & publication status
-- Free tier predictions are visible to any authenticated user
CREATE POLICY "predictions_read_policy" ON public.football_predictions
    FOR SELECT USING (
        publication_status = 'published'
        AND (
            tier_required = 'free'
            OR EXISTS (
                SELECT 1 FROM public.entitlements e
                WHERE e.user_id = auth.uid()
                AND (
                    e.tier = 'premium'
                    OR (e.tier = 'pro' AND football_predictions.tier_required IN ('free', 'pro'))
                )
                AND (e.valid_until IS NULL OR e.valid_until > now())
            )
        )
    );

CREATE POLICY "prediction_markets_read_policy" ON public.football_prediction_markets
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.football_predictions p
            WHERE p.id = football_prediction_markets.prediction_id
            AND p.publication_status = 'published'
        )
    );

-- 4.8 Settlements visible to users who can read the prediction
CREATE POLICY "settlements_read_policy" ON public.football_settlements
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.football_predictions p
            WHERE p.id = football_settlements.prediction_id
        )
    );

-- 4.9 Simulations viewable by premium subscribers
CREATE POLICY "simulations_premium_read" ON public.football_simulations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.entitlements e
            WHERE e.user_id = auth.uid()
            AND e.tier = 'premium'
            AND (e.valid_until IS NULL OR e.valid_until > now())
        )
    );

-- Service-role bypasses RLS automatically in Supabase, so server-side operations
-- have full unrestricted access while client-side keys respect these strict boundaries.

-- =====================================================================
-- 5. INITIAL DATA SEED (Verified Sources & Core Leagues)
-- =====================================================================

INSERT INTO public.data_sources (name, display_name, base_url, source_type, supports_fixtures, supports_live, supports_results, priority, enabled)
VALUES
    ('espn', 'ESPN Soccer', 'https://www.espn.com/soccer', 'scraper', true, true, true, 10, true),
    ('livescore', 'LiveScore', 'https://www.livescore.com', 'scraper', true, true, true, 20, true),
    ('flashscore', 'Flashscore', 'https://www.flashscore.com', 'scraper', true, true, true, 30, true),
    ('football_data_org', 'Football-Data.org', 'https://api.football-data.org/v4', 'api', true, false, true, 15, true),
    ('api_football', 'API-Football (API-Sports)', 'https://v3.football.api-sports.io', 'api', true, true, true, 25, true)
ON CONFLICT (name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    base_url = EXCLUDED.base_url,
    supports_fixtures = EXCLUDED.supports_fixtures,
    supports_live = EXCLUDED.supports_live,
    supports_results = EXCLUDED.supports_results,
    priority = EXCLUDED.priority,
    enabled = EXCLUDED.enabled;

INSERT INTO public.football_leagues (name, canonical_slug, country, tier, season, active)
VALUES
    ('Premier League', 'eng-premier-league', 'ENG', 1, '2026-27', true),
    ('La Liga', 'esp-la-liga', 'ESP', 1, '2026-27', true),
    ('Serie A', 'ita-serie-a', 'ITA', 1, '2026-27', true),
    ('Bundesliga', 'ger-bundesliga', 'GER', 1, '2026-27', true),
    ('Ligue 1', 'fra-ligue-1', 'FRA', 1, '2026-27', true),
    ('UEFA Champions League', 'uefa-champions-league', 'EUR', 1, '2026-27', true)
ON CONFLICT (canonical_slug) DO UPDATE SET
    name = EXCLUDED.name,
    country = EXCLUDED.country,
    tier = EXCLUDED.tier,
    active = EXCLUDED.active;
