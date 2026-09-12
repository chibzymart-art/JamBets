-- =====================================================================
-- JamBets — Goals Specialist Engine (Over 2.5 & 1H Over 0.5 Goals)
-- Completely isolated tables, paywall view, and RLS policies
-- ZERO interference with core football_predictions or settlements
-- =====================================================================

-- 1. Goals Predictions Table
CREATE TABLE IF NOT EXISTS public.goals_predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fixture_id UUID NOT NULL REFERENCES public.football_fixtures(id) ON DELETE CASCADE,
    market TEXT NOT NULL CHECK (market IN ('over_2.5_goals', 'ht_over_0.5_goals')),
    predicted_outcome TEXT NOT NULL, -- 'OVER_2.5' or 'HT_OVER_0.5'
    probability DECIMAL(5,4) NOT NULL CHECK (probability >= 0.0000 AND probability <= 1.0000),
    confidence_tier TEXT NOT NULL CHECK (confidence_tier IN ('GOAL_MACHINE', 'OVER_25_LOCK', 'EARLY_STRIKE', 'TEMPO_HIGH', 'LEAN_OVER', 'LOCKED')),
    xg_combined DECIMAL(4,2),
    home_over25_rate INTEGER, -- e.g. 80 (meaning 80%)
    away_over25_rate INTEGER, -- e.g. 70
    h2h_over25_rate INTEGER,
    ht_goal_frequency INTEGER, -- e.g. 85 (85% of matches have 1H goal)
    avg_first_goal_minute INTEGER, -- e.g. 23
    target_kickoff_at TIMESTAMPTZ NOT NULL,
    settlement_status TEXT NOT NULL DEFAULT 'pending' CHECK (settlement_status IN ('pending', 'won', 'lost', 'void')),
    settled_at TIMESTAMPTZ,
    actual_score TEXT,
    ht_score TEXT,
    settlement_notes TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(fixture_id, market)
);

-- 2. Goals Settlements Table
CREATE TABLE IF NOT EXISTS public.goals_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prediction_id UUID NOT NULL REFERENCES public.goals_predictions(id) ON DELETE CASCADE,
    fixture_id UUID NOT NULL REFERENCES public.football_fixtures(id) ON DELETE CASCADE,
    market TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('won', 'lost', 'void')),
    final_score TEXT,
    ht_score TEXT,
    total_goals INTEGER,
    ht_goals INTEGER,
    settled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(prediction_id)
);

-- 3. Indexes for High-Performance Querying
CREATE INDEX IF NOT EXISTS idx_goals_pred_fixture ON public.goals_predictions(fixture_id);
CREATE INDEX IF NOT EXISTS idx_goals_pred_market ON public.goals_predictions(market);
CREATE INDEX IF NOT EXISTS idx_goals_pred_status ON public.goals_predictions(settlement_status);
CREATE INDEX IF NOT EXISTS idx_goals_pred_kickoff ON public.goals_predictions(target_kickoff_at);
CREATE INDEX IF NOT EXISTS idx_goals_settlements_pred ON public.goals_settlements(prediction_id);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.goals_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goals_settlements ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies: Service Role Full Access
DROP POLICY IF EXISTS "goals_predictions_service_role_all" ON public.goals_predictions;
CREATE POLICY "goals_predictions_service_role_all" ON public.goals_predictions
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "goals_settlements_service_role_all" ON public.goals_settlements;
CREATE POLICY "goals_settlements_service_role_all" ON public.goals_settlements
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 6. RLS Policies: Read Access for Authenticated Paid Users & Admins
DROP POLICY IF EXISTS "goals_predictions_paid_read" ON public.goals_predictions;
CREATE POLICY "goals_predictions_paid_read" ON public.goals_predictions
    FOR SELECT TO authenticated
    USING (
        public.is_admin() OR
        public.is_paid_subscriber() OR
        EXISTS (
            SELECT 1 FROM public.entitlements e
            WHERE e.user_id = auth.uid()
              AND e.tier IN ('standard', 'bigbang', 'pro', 'premium', 'admin')
              AND (e.valid_until IS NULL OR e.valid_until > now())
        )
    );

DROP POLICY IF EXISTS "goals_settlements_public_read" ON public.goals_settlements;
CREATE POLICY "goals_settlements_public_read" ON public.goals_settlements
    FOR SELECT TO anon, authenticated
    USING (true);

-- 7. Dynamic Paywall View for Edge CDN & Front-End Teaser View
DROP VIEW IF EXISTS public.goals_predictions_paywall;

CREATE OR REPLACE VIEW public.goals_predictions_paywall AS
SELECT
    g.id,
    g.fixture_id,
    g.market,
    CASE
        WHEN public.is_admin() THEN g.predicted_outcome
        WHEN public.is_paid_subscriber() THEN g.predicted_outcome
        WHEN g.settlement_status IN ('won', 'lost', 'void') THEN g.predicted_outcome
        WHEN f.status IN ('settled', 'finished', 'ft', 'aet', 'pen') THEN g.predicted_outcome
        ELSE 'LOCKED'
    END AS predicted_outcome,
    CASE
        WHEN public.is_admin() THEN g.probability
        WHEN public.is_paid_subscriber() THEN g.probability
        WHEN g.settlement_status IN ('won', 'lost', 'void') THEN g.probability
        WHEN f.status IN ('settled', 'finished', 'ft', 'aet', 'pen') THEN g.probability
        ELSE NULL
    END AS probability,
    CASE
        WHEN public.is_admin() THEN g.confidence_tier
        WHEN public.is_paid_subscriber() THEN g.confidence_tier
        WHEN g.settlement_status IN ('won', 'lost', 'void') THEN g.confidence_tier
        WHEN f.status IN ('settled', 'finished', 'ft', 'aet', 'pen') THEN g.confidence_tier
        ELSE 'LOCKED'
    END AS confidence_tier,
    g.xg_combined,
    g.home_over25_rate,
    g.away_over25_rate,
    g.h2h_over25_rate,
    g.ht_goal_frequency,
    g.avg_first_goal_minute,
    g.target_kickoff_at,
    g.settlement_status,
    g.settled_at,
    g.actual_score,
    g.ht_score,
    g.settlement_notes,
    g.metadata,
    g.created_at,
    g.updated_at,
    CASE
        WHEN public.is_admin() THEN false
        WHEN public.is_paid_subscriber() THEN false
        WHEN g.settlement_status IN ('won', 'lost', 'void') THEN false
        WHEN f.status IN ('settled', 'finished', 'ft', 'aet', 'pen') THEN false
        ELSE true
    END AS is_locked
FROM public.goals_predictions g
LEFT JOIN public.football_fixtures f ON g.fixture_id = f.id;

GRANT SELECT ON public.goals_predictions_paywall TO anon, authenticated, service_role;
