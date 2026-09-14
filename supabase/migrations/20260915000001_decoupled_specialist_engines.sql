-- =====================================================================
-- JamBets — Decoupled Specialist Engines Schema
-- 1. Home Win Dominance Engine (home_win_predictions)
-- 2. Away Win Road Counter Engine (away_win_predictions)
-- 3. Draw Hunter Equilibrium Engine (draw_predictions)
-- 4. Corners Specialist Engine (corner_predictions)
--
-- Each engine operates with strictly isolated tables, independent
-- settlement pipelines, and dynamic paywall views with field-level RLS.
-- =====================================================================

-- =====================================================================
-- 1. HOME WIN SPECIALIST ENGINE (Home Venue Dominance Model)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.home_win_predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fixture_id UUID NOT NULL REFERENCES public.football_fixtures(id) ON DELETE CASCADE,
    predicted_outcome TEXT NOT NULL DEFAULT 'HOME_WIN',
    probability DECIMAL(5,4) NOT NULL CHECK (probability >= 0.0000 AND probability <= 1.0000),
    dominance_tier TEXT NOT NULL CHECK (dominance_tier IN ('FORTRESS_LOCK', 'HIGH_DOMINANCE', 'VALUE_EDGE', 'SLIGHT_EDGE', 'LOCKED')),
    home_venue_advantage DECIMAL(4,2),
    home_clean_sheet_prob DECIMAL(4,2),
    xg_home DECIMAL(4,2),
    xg_away DECIMAL(4,2),
    target_kickoff_at TIMESTAMPTZ NOT NULL,
    settlement_status TEXT NOT NULL DEFAULT 'pending' CHECK (settlement_status IN ('pending', 'won', 'lost', 'void')),
    settled_at TIMESTAMPTZ,
    actual_score TEXT,
    settlement_notes TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(fixture_id)
);

CREATE TABLE IF NOT EXISTS public.home_win_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prediction_id UUID NOT NULL REFERENCES public.home_win_predictions(id) ON DELETE CASCADE UNIQUE,
    fixture_id UUID NOT NULL REFERENCES public.football_fixtures(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('won', 'lost', 'void')),
    final_score TEXT,
    settled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_home_win_pred_fixture ON public.home_win_predictions(fixture_id);
CREATE INDEX IF NOT EXISTS idx_home_win_pred_status ON public.home_win_predictions(settlement_status);
CREATE INDEX IF NOT EXISTS idx_home_win_pred_kickoff ON public.home_win_predictions(target_kickoff_at);

ALTER TABLE public.home_win_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.home_win_settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "home_win_predictions_service_role_all" ON public.home_win_predictions;
CREATE POLICY "home_win_predictions_service_role_all" ON public.home_win_predictions
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "home_win_settlements_service_role_all" ON public.home_win_settlements;
CREATE POLICY "home_win_settlements_service_role_all" ON public.home_win_settlements
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "home_win_predictions_paid_read" ON public.home_win_predictions;
CREATE POLICY "home_win_predictions_paid_read" ON public.home_win_predictions
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

DROP POLICY IF EXISTS "home_win_settlements_public_read" ON public.home_win_settlements;
CREATE POLICY "home_win_settlements_public_read" ON public.home_win_settlements
    FOR SELECT TO anon, authenticated USING (true);

DROP VIEW IF EXISTS public.home_win_predictions_paywall;
CREATE OR REPLACE VIEW public.home_win_predictions_paywall AS
SELECT
    h.id,
    h.fixture_id,
    CASE
        WHEN public.is_admin() THEN h.predicted_outcome
        WHEN public.is_paid_subscriber() THEN h.predicted_outcome
        WHEN h.settlement_status IN ('won', 'lost', 'void') THEN h.predicted_outcome
        WHEN f.status IN ('settled', 'finished', 'ft', 'aet', 'pen') THEN h.predicted_outcome
        ELSE 'LOCKED'
    END AS predicted_outcome,
    CASE
        WHEN public.is_admin() THEN h.probability
        WHEN public.is_paid_subscriber() THEN h.probability
        WHEN h.settlement_status IN ('won', 'lost', 'void') THEN h.probability
        WHEN f.status IN ('settled', 'finished', 'ft', 'aet', 'pen') THEN h.probability
        ELSE NULL
    END AS probability,
    CASE
        WHEN public.is_admin() THEN h.dominance_tier
        WHEN public.is_paid_subscriber() THEN h.dominance_tier
        WHEN h.settlement_status IN ('won', 'lost', 'void') THEN h.dominance_tier
        WHEN f.status IN ('settled', 'finished', 'ft', 'aet', 'pen') THEN h.dominance_tier
        ELSE 'LOCKED'
    END AS dominance_tier,
    h.home_venue_advantage,
    h.home_clean_sheet_prob,
    h.xg_home,
    h.xg_away,
    h.target_kickoff_at,
    h.settlement_status,
    h.settled_at,
    h.actual_score,
    h.settlement_notes,
    h.metadata,
    h.created_at,
    h.updated_at,
    CASE
        WHEN public.is_admin() THEN false
        WHEN public.is_paid_subscriber() THEN false
        WHEN h.settlement_status IN ('won', 'lost', 'void') THEN false
        WHEN f.status IN ('settled', 'finished', 'ft', 'aet', 'pen') THEN false
        ELSE true
    END AS is_locked
FROM public.home_win_predictions h
LEFT JOIN public.football_fixtures f ON h.fixture_id = f.id;

GRANT SELECT ON public.home_win_predictions_paywall TO anon, authenticated, service_role;


-- =====================================================================
-- 2. AWAY WIN SPECIALIST ENGINE (Road Counter & Value Inefficiency Model)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.away_win_predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fixture_id UUID NOT NULL REFERENCES public.football_fixtures(id) ON DELETE CASCADE,
    predicted_outcome TEXT NOT NULL DEFAULT 'AWAY_WIN',
    probability DECIMAL(5,4) NOT NULL CHECK (probability >= 0.0000 AND probability <= 1.0000),
    counter_tier TEXT NOT NULL CHECK (counter_tier IN ('ROAD_RAIDER', 'COUNTER_LOCK', 'UPSET_ALERT', 'VALUE_AWAY', 'LOCKED')),
    away_counter_efficiency DECIMAL(4,2),
    away_clean_sheet_prob DECIMAL(4,2),
    xg_home DECIMAL(4,2),
    xg_away DECIMAL(4,2),
    target_kickoff_at TIMESTAMPTZ NOT NULL,
    settlement_status TEXT NOT NULL DEFAULT 'pending' CHECK (settlement_status IN ('pending', 'won', 'lost', 'void')),
    settled_at TIMESTAMPTZ,
    actual_score TEXT,
    settlement_notes TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(fixture_id)
);

CREATE TABLE IF NOT EXISTS public.away_win_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prediction_id UUID NOT NULL REFERENCES public.away_win_predictions(id) ON DELETE CASCADE UNIQUE,
    fixture_id UUID NOT NULL REFERENCES public.football_fixtures(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('won', 'lost', 'void')),
    final_score TEXT,
    settled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_away_win_pred_fixture ON public.away_win_predictions(fixture_id);
CREATE INDEX IF NOT EXISTS idx_away_win_pred_status ON public.away_win_predictions(settlement_status);
CREATE INDEX IF NOT EXISTS idx_away_win_pred_kickoff ON public.away_win_predictions(target_kickoff_at);

ALTER TABLE public.away_win_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.away_win_settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "away_win_predictions_service_role_all" ON public.away_win_predictions;
CREATE POLICY "away_win_predictions_service_role_all" ON public.away_win_predictions
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "away_win_settlements_service_role_all" ON public.away_win_settlements;
CREATE POLICY "away_win_settlements_service_role_all" ON public.away_win_settlements
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "away_win_predictions_paid_read" ON public.away_win_predictions;
CREATE POLICY "away_win_predictions_paid_read" ON public.away_win_predictions
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

DROP POLICY IF EXISTS "away_win_settlements_public_read" ON public.away_win_settlements;
CREATE POLICY "away_win_settlements_public_read" ON public.away_win_settlements
    FOR SELECT TO anon, authenticated USING (true);

DROP VIEW IF EXISTS public.away_win_predictions_paywall;
CREATE OR REPLACE VIEW public.away_win_predictions_paywall AS
SELECT
    a.id,
    a.fixture_id,
    CASE
        WHEN public.is_admin() THEN a.predicted_outcome
        WHEN public.is_paid_subscriber() THEN a.predicted_outcome
        WHEN a.settlement_status IN ('won', 'lost', 'void') THEN a.predicted_outcome
        WHEN f.status IN ('settled', 'finished', 'ft', 'aet', 'pen') THEN a.predicted_outcome
        ELSE 'LOCKED'
    END AS predicted_outcome,
    CASE
        WHEN public.is_admin() THEN a.probability
        WHEN public.is_paid_subscriber() THEN a.probability
        WHEN a.settlement_status IN ('won', 'lost', 'void') THEN a.probability
        WHEN f.status IN ('settled', 'finished', 'ft', 'aet', 'pen') THEN a.probability
        ELSE NULL
    END AS probability,
    CASE
        WHEN public.is_admin() THEN a.counter_tier
        WHEN public.is_paid_subscriber() THEN a.counter_tier
        WHEN a.settlement_status IN ('won', 'lost', 'void') THEN a.counter_tier
        WHEN f.status IN ('settled', 'finished', 'ft', 'aet', 'pen') THEN a.counter_tier
        ELSE 'LOCKED'
    END AS counter_tier,
    a.away_counter_efficiency,
    a.away_clean_sheet_prob,
    a.xg_home,
    a.xg_away,
    a.target_kickoff_at,
    a.settlement_status,
    a.settled_at,
    a.actual_score,
    a.settlement_notes,
    a.metadata,
    a.created_at,
    a.updated_at,
    CASE
        WHEN public.is_admin() THEN false
        WHEN public.is_paid_subscriber() THEN false
        WHEN a.settlement_status IN ('won', 'lost', 'void') THEN false
        WHEN f.status IN ('settled', 'finished', 'ft', 'aet', 'pen') THEN false
        ELSE true
    END AS is_locked
FROM public.away_win_predictions a
LEFT JOIN public.football_fixtures f ON a.fixture_id = f.id;

GRANT SELECT ON public.away_win_predictions_paywall TO anon, authenticated, service_role;


-- =====================================================================
-- 3. DRAW HUNTER SPECIALIST ENGINE (Zero-Inflated Skellam Equilibrium)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.draw_predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fixture_id UUID NOT NULL REFERENCES public.football_fixtures(id) ON DELETE CASCADE,
    predicted_outcome TEXT NOT NULL DEFAULT 'DRAW',
    probability DECIMAL(5,4) NOT NULL CHECK (probability >= 0.0000 AND probability <= 1.0000),
    stalemate_tier TEXT NOT NULL CHECK (stalemate_tier IN ('STALEMATE_LOCK', 'DEADLOCK_VALUE', 'MUTUAL_POINT', 'PARITY_LEAN', 'LOCKED')),
    tactical_equilibrium_score DECIMAL(4,2),
    low_scoring_density DECIMAL(4,2), -- Joint probability of 0-0 or 1-1
    target_kickoff_at TIMESTAMPTZ NOT NULL,
    settlement_status TEXT NOT NULL DEFAULT 'pending' CHECK (settlement_status IN ('pending', 'won', 'lost', 'void')),
    settled_at TIMESTAMPTZ,
    actual_score TEXT,
    settlement_notes TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(fixture_id)
);

CREATE TABLE IF NOT EXISTS public.draw_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prediction_id UUID NOT NULL REFERENCES public.draw_predictions(id) ON DELETE CASCADE UNIQUE,
    fixture_id UUID NOT NULL REFERENCES public.football_fixtures(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('won', 'lost', 'void')),
    final_score TEXT,
    settled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_draw_pred_fixture ON public.draw_predictions(fixture_id);
CREATE INDEX IF NOT EXISTS idx_draw_pred_status ON public.draw_predictions(settlement_status);
CREATE INDEX IF NOT EXISTS idx_draw_pred_kickoff ON public.draw_predictions(target_kickoff_at);

ALTER TABLE public.draw_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draw_settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "draw_predictions_service_role_all" ON public.draw_predictions;
CREATE POLICY "draw_predictions_service_role_all" ON public.draw_predictions
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "draw_settlements_service_role_all" ON public.draw_settlements;
CREATE POLICY "draw_settlements_service_role_all" ON public.draw_settlements
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "draw_predictions_paid_read" ON public.draw_predictions;
CREATE POLICY "draw_predictions_paid_read" ON public.draw_predictions
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

DROP POLICY IF EXISTS "draw_settlements_public_read" ON public.draw_settlements;
CREATE POLICY "draw_settlements_public_read" ON public.draw_settlements
    FOR SELECT TO anon, authenticated USING (true);

DROP VIEW IF EXISTS public.draw_predictions_paywall;
CREATE OR REPLACE VIEW public.draw_predictions_paywall AS
SELECT
    d.id,
    d.fixture_id,
    CASE
        WHEN public.is_admin() THEN d.predicted_outcome
        WHEN public.is_paid_subscriber() THEN d.predicted_outcome
        WHEN d.settlement_status IN ('won', 'lost', 'void') THEN d.predicted_outcome
        WHEN f.status IN ('settled', 'finished', 'ft', 'aet', 'pen') THEN d.predicted_outcome
        ELSE 'LOCKED'
    END AS predicted_outcome,
    CASE
        WHEN public.is_admin() THEN d.probability
        WHEN public.is_paid_subscriber() THEN d.probability
        WHEN d.settlement_status IN ('won', 'lost', 'void') THEN d.probability
        WHEN f.status IN ('settled', 'finished', 'ft', 'aet', 'pen') THEN d.probability
        ELSE NULL
    END AS probability,
    CASE
        WHEN public.is_admin() THEN d.stalemate_tier
        WHEN public.is_paid_subscriber() THEN d.stalemate_tier
        WHEN d.settlement_status IN ('won', 'lost', 'void') THEN d.stalemate_tier
        WHEN f.status IN ('settled', 'finished', 'ft', 'aet', 'pen') THEN d.stalemate_tier
        ELSE 'LOCKED'
    END AS stalemate_tier,
    d.tactical_equilibrium_score,
    d.low_scoring_density,
    d.target_kickoff_at,
    d.settlement_status,
    d.settled_at,
    d.actual_score,
    d.settlement_notes,
    d.metadata,
    d.created_at,
    d.updated_at,
    CASE
        WHEN public.is_admin() THEN false
        WHEN public.is_paid_subscriber() THEN false
        WHEN d.settlement_status IN ('won', 'lost', 'void') THEN false
        WHEN f.status IN ('settled', 'finished', 'ft', 'aet', 'pen') THEN false
        ELSE true
    END AS is_locked
FROM public.draw_predictions d
LEFT JOIN public.football_fixtures f ON d.fixture_id = f.id;

GRANT SELECT ON public.draw_predictions_paywall TO anon, authenticated, service_role;


-- =====================================================================
-- 4. CORNERS SPECIALIST ENGINE (Geometric Set-Piece GLM Model)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.corner_predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fixture_id UUID NOT NULL REFERENCES public.football_fixtures(id) ON DELETE CASCADE,
    market TEXT NOT NULL CHECK (market IN ('over_8.5_corners', 'over_9.5_corners', 'over_10.5_corners')),
    predicted_outcome TEXT NOT NULL,
    probability DECIMAL(5,4) NOT NULL CHECK (probability >= 0.0000 AND probability <= 1.0000),
    corner_tier TEXT NOT NULL CHECK (corner_tier IN ('CORNER_FEST', 'WING_PRESSURE', 'HIGH_CROSS_VOLUME', 'LEAN_OVER', 'LOCKED')),
    predicted_total_corners DECIMAL(4,1),
    home_corners_avg DECIMAL(4,1),
    away_corners_avg DECIMAL(4,1),
    target_kickoff_at TIMESTAMPTZ NOT NULL,
    settlement_status TEXT NOT NULL DEFAULT 'pending' CHECK (settlement_status IN ('pending', 'won', 'lost', 'void')),
    settled_at TIMESTAMPTZ,
    actual_corners_total INTEGER,
    settlement_notes TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(fixture_id, market)
);

CREATE TABLE IF NOT EXISTS public.corner_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prediction_id UUID NOT NULL REFERENCES public.corner_predictions(id) ON DELETE CASCADE,
    fixture_id UUID NOT NULL REFERENCES public.football_fixtures(id) ON DELETE CASCADE,
    market TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('won', 'lost', 'void')),
    total_corners INTEGER,
    home_corners INTEGER,
    away_corners INTEGER,
    settled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(prediction_id)
);

CREATE INDEX IF NOT EXISTS idx_corner_pred_fixture ON public.corner_predictions(fixture_id);
CREATE INDEX IF NOT EXISTS idx_corner_pred_market ON public.corner_predictions(market);
CREATE INDEX IF NOT EXISTS idx_corner_pred_status ON public.corner_predictions(settlement_status);
CREATE INDEX IF NOT EXISTS idx_corner_pred_kickoff ON public.corner_predictions(target_kickoff_at);

ALTER TABLE public.corner_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corner_settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "corner_predictions_service_role_all" ON public.corner_predictions;
CREATE POLICY "corner_predictions_service_role_all" ON public.corner_predictions
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "corner_settlements_service_role_all" ON public.corner_settlements;
CREATE POLICY "corner_settlements_service_role_all" ON public.corner_settlements
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "corner_predictions_paid_read" ON public.corner_predictions;
CREATE POLICY "corner_predictions_paid_read" ON public.corner_predictions
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

DROP POLICY IF EXISTS "corner_settlements_public_read" ON public.corner_settlements;
CREATE POLICY "corner_settlements_public_read" ON public.corner_settlements
    FOR SELECT TO anon, authenticated USING (true);

DROP VIEW IF EXISTS public.corner_predictions_paywall;
CREATE OR REPLACE VIEW public.corner_predictions_paywall AS
SELECT
    c.id,
    c.fixture_id,
    c.market,
    CASE
        WHEN public.is_admin() THEN c.predicted_outcome
        WHEN public.is_paid_subscriber() THEN c.predicted_outcome
        WHEN c.settlement_status IN ('won', 'lost', 'void') THEN c.predicted_outcome
        WHEN f.status IN ('settled', 'finished', 'ft', 'aet', 'pen') THEN c.predicted_outcome
        ELSE 'LOCKED'
    END AS predicted_outcome,
    CASE
        WHEN public.is_admin() THEN c.probability
        WHEN public.is_paid_subscriber() THEN c.probability
        WHEN c.settlement_status IN ('won', 'lost', 'void') THEN c.probability
        WHEN f.status IN ('settled', 'finished', 'ft', 'aet', 'pen') THEN c.probability
        ELSE NULL
    END AS probability,
    CASE
        WHEN public.is_admin() THEN c.corner_tier
        WHEN public.is_paid_subscriber() THEN c.corner_tier
        WHEN c.settlement_status IN ('won', 'lost', 'void') THEN c.corner_tier
        WHEN f.status IN ('settled', 'finished', 'ft', 'aet', 'pen') THEN c.corner_tier
        ELSE 'LOCKED'
    END AS corner_tier,
    c.predicted_total_corners,
    c.home_corners_avg,
    c.away_corners_avg,
    c.target_kickoff_at,
    c.settlement_status,
    c.settled_at,
    c.actual_corners_total,
    c.settlement_notes,
    c.metadata,
    c.created_at,
    c.updated_at,
    CASE
        WHEN public.is_admin() THEN false
        WHEN public.is_paid_subscriber() THEN false
        WHEN c.settlement_status IN ('won', 'lost', 'void') THEN false
        WHEN f.status IN ('settled', 'finished', 'ft', 'aet', 'pen') THEN false
        ELSE true
    END AS is_locked
FROM public.corner_predictions c
LEFT JOIN public.football_fixtures f ON c.fixture_id = f.id;

GRANT SELECT ON public.corner_predictions_paywall TO anon, authenticated, service_role;


-- =====================================================================
-- 5. PERMANENT 2-DAY PREDICTION IMMUTABILITY TRIGGERS
-- Protects all 4 specialist engines from recalculation / overwrite
-- =====================================================================

-- 5a. Home Win Immutability
CREATE OR REPLACE FUNCTION public.enforce_home_win_immutability()
RETURNS TRIGGER AS $$
DECLARE
    v_lock_window TIMESTAMPTZ := NOW() + INTERVAL '2 days';
    v_is_locked BOOLEAN := false;
BEGIN
    IF OLD.settlement_status IN ('won', 'lost', 'void') THEN
        IF NEW.settlement_status = 'pending' THEN
            NEW.settlement_status := OLD.settlement_status;
        END IF;
        NEW.fixture_id := OLD.fixture_id;
        NEW.predicted_outcome := OLD.predicted_outcome;
        NEW.probability := OLD.probability;
        NEW.dominance_tier := OLD.dominance_tier;
        NEW.home_venue_advantage := OLD.home_venue_advantage;
        NEW.home_clean_sheet_prob := OLD.home_clean_sheet_prob;
        NEW.xg_home := OLD.xg_home;
        NEW.xg_away := OLD.xg_away;
        NEW.target_kickoff_at := OLD.target_kickoff_at;
        RETURN NEW;
    END IF;

    IF OLD.target_kickoff_at IS NOT NULL AND OLD.target_kickoff_at <= v_lock_window THEN
        v_is_locked := true;
    END IF;

    IF v_is_locked THEN
        NEW.fixture_id := OLD.fixture_id;
        NEW.predicted_outcome := OLD.predicted_outcome;
        NEW.probability := OLD.probability;
        NEW.dominance_tier := OLD.dominance_tier;
        NEW.home_venue_advantage := OLD.home_venue_advantage;
        NEW.home_clean_sheet_prob := OLD.home_clean_sheet_prob;
        NEW.xg_home := OLD.xg_home;
        NEW.xg_away := OLD.xg_away;
        NEW.target_kickoff_at := OLD.target_kickoff_at;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_enforce_home_win_immutability ON public.home_win_predictions;
CREATE TRIGGER trg_enforce_home_win_immutability
    BEFORE UPDATE ON public.home_win_predictions
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_home_win_immutability();

-- 5b. Away Win Immutability
CREATE OR REPLACE FUNCTION public.enforce_away_win_immutability()
RETURNS TRIGGER AS $$
DECLARE
    v_lock_window TIMESTAMPTZ := NOW() + INTERVAL '2 days';
    v_is_locked BOOLEAN := false;
BEGIN
    IF OLD.settlement_status IN ('won', 'lost', 'void') THEN
        IF NEW.settlement_status = 'pending' THEN
            NEW.settlement_status := OLD.settlement_status;
        END IF;
        NEW.fixture_id := OLD.fixture_id;
        NEW.predicted_outcome := OLD.predicted_outcome;
        NEW.probability := OLD.probability;
        NEW.counter_tier := OLD.counter_tier;
        NEW.away_counter_efficiency := OLD.away_counter_efficiency;
        NEW.away_clean_sheet_prob := OLD.away_clean_sheet_prob;
        NEW.xg_home := OLD.xg_home;
        NEW.xg_away := OLD.xg_away;
        NEW.target_kickoff_at := OLD.target_kickoff_at;
        RETURN NEW;
    END IF;

    IF OLD.target_kickoff_at IS NOT NULL AND OLD.target_kickoff_at <= v_lock_window THEN
        v_is_locked := true;
    END IF;

    IF v_is_locked THEN
        NEW.fixture_id := OLD.fixture_id;
        NEW.predicted_outcome := OLD.predicted_outcome;
        NEW.probability := OLD.probability;
        NEW.counter_tier := OLD.counter_tier;
        NEW.away_counter_efficiency := OLD.away_counter_efficiency;
        NEW.away_clean_sheet_prob := OLD.away_clean_sheet_prob;
        NEW.xg_home := OLD.xg_home;
        NEW.xg_away := OLD.xg_away;
        NEW.target_kickoff_at := OLD.target_kickoff_at;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_enforce_away_win_immutability ON public.away_win_predictions;
CREATE TRIGGER trg_enforce_away_win_immutability
    BEFORE UPDATE ON public.away_win_predictions
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_away_win_immutability();

-- 5c. Draw Hunter Immutability
CREATE OR REPLACE FUNCTION public.enforce_draw_immutability()
RETURNS TRIGGER AS $$
DECLARE
    v_lock_window TIMESTAMPTZ := NOW() + INTERVAL '2 days';
    v_is_locked BOOLEAN := false;
BEGIN
    IF OLD.settlement_status IN ('won', 'lost', 'void') THEN
        IF NEW.settlement_status = 'pending' THEN
            NEW.settlement_status := OLD.settlement_status;
        END IF;
        NEW.fixture_id := OLD.fixture_id;
        NEW.predicted_outcome := OLD.predicted_outcome;
        NEW.probability := OLD.probability;
        NEW.stalemate_tier := OLD.stalemate_tier;
        NEW.tactical_equilibrium_score := OLD.tactical_equilibrium_score;
        NEW.low_scoring_density := OLD.low_scoring_density;
        NEW.target_kickoff_at := OLD.target_kickoff_at;
        RETURN NEW;
    END IF;

    IF OLD.target_kickoff_at IS NOT NULL AND OLD.target_kickoff_at <= v_lock_window THEN
        v_is_locked := true;
    END IF;

    IF v_is_locked THEN
        NEW.fixture_id := OLD.fixture_id;
        NEW.predicted_outcome := OLD.predicted_outcome;
        NEW.probability := OLD.probability;
        NEW.stalemate_tier := OLD.stalemate_tier;
        NEW.tactical_equilibrium_score := OLD.tactical_equilibrium_score;
        NEW.low_scoring_density := OLD.low_scoring_density;
        NEW.target_kickoff_at := OLD.target_kickoff_at;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_enforce_draw_immutability ON public.draw_predictions;
CREATE TRIGGER trg_enforce_draw_immutability
    BEFORE UPDATE ON public.draw_predictions
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_draw_immutability();

-- 5d. Corners Immutability
CREATE OR REPLACE FUNCTION public.enforce_corner_immutability()
RETURNS TRIGGER AS $$
DECLARE
    v_lock_window TIMESTAMPTZ := NOW() + INTERVAL '2 days';
    v_is_locked BOOLEAN := false;
BEGIN
    IF OLD.settlement_status IN ('won', 'lost', 'void') THEN
        IF NEW.settlement_status = 'pending' THEN
            NEW.settlement_status := OLD.settlement_status;
        END IF;
        NEW.fixture_id := OLD.fixture_id;
        NEW.market := OLD.market;
        NEW.predicted_outcome := OLD.predicted_outcome;
        NEW.probability := OLD.probability;
        NEW.corner_tier := OLD.corner_tier;
        NEW.predicted_total_corners := OLD.predicted_total_corners;
        NEW.home_corners_avg := OLD.home_corners_avg;
        NEW.away_corners_avg := OLD.away_corners_avg;
        NEW.target_kickoff_at := OLD.target_kickoff_at;
        RETURN NEW;
    END IF;

    IF OLD.target_kickoff_at IS NOT NULL AND OLD.target_kickoff_at <= v_lock_window THEN
        v_is_locked := true;
    END IF;

    IF v_is_locked THEN
        NEW.fixture_id := OLD.fixture_id;
        NEW.market := OLD.market;
        NEW.predicted_outcome := OLD.predicted_outcome;
        NEW.probability := OLD.probability;
        NEW.corner_tier := OLD.corner_tier;
        NEW.predicted_total_corners := OLD.predicted_total_corners;
        NEW.home_corners_avg := OLD.home_corners_avg;
        NEW.away_corners_avg := OLD.away_corners_avg;
        NEW.target_kickoff_at := OLD.target_kickoff_at;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_enforce_corner_immutability ON public.corner_predictions;
CREATE TRIGGER trg_enforce_corner_immutability
    BEFORE UPDATE ON public.corner_predictions
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_corner_immutability();

