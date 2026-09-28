-- =====================================================================
-- JamBets / Oddsbanta — Security Hardening & Zero-Day Paywall Lockdown
-- 1. Neutralize upgrade_subscription_tier RPC (Prevent self-elevation)
-- 2. Restrict public.football_predictions so anon/unpaid only read WON matches
-- 3. Restrict all settlement tables so anon/unpaid only read WON matches
-- =====================================================================

-- 1. REVOKE & HARDEN upgrade_subscription_tier
-- Prevent free users from self-elevating to VIP without payment verification
REVOKE EXECUTE ON FUNCTION public.upgrade_subscription_tier(TEXT) FROM authenticated, anon, public;

CREATE OR REPLACE FUNCTION public.upgrade_subscription_tier(target_tier TEXT)
RETURNS jsonb AS $$
DECLARE
    v_caller_role TEXT;
BEGIN
    v_caller_role := auth.role();
    
    -- Strict Enforce: Only backend service_role or admin can execute tier changes
    IF v_caller_role != 'service_role' AND NOT public.is_admin() THEN
        RAISE EXCEPTION 'Security Violation: Subscription upgrades can only be processed via verified payment gateway webhooks or system administrators.';
    END IF;

    IF target_tier NOT IN ('free', 'standard', 'bigbang') THEN
        RAISE EXCEPTION 'Invalid tier: %', target_tier;
    END IF;

    RETURN jsonb_build_object('success', false, 'error', 'Manual or webhook authorization required.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.upgrade_subscription_tier(TEXT) TO service_role;


-- 2. HARDEN football_predictions RLS
-- Restrict anon & unpaid read access strictly to 'won' games (historical proof)
-- Unsettled (pending) predictions strictly require active paid subscription or admin
ALTER TABLE public.football_predictions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "predictions_paywall_read_policy" ON public.football_predictions;
DROP POLICY IF EXISTS "Public read football_predictions" ON public.football_predictions;
DROP POLICY IF EXISTS "predictions_read_policy" ON public.football_predictions;
DROP POLICY IF EXISTS "predictions_entitled_read_policy" ON public.football_predictions;

CREATE POLICY "predictions_paywall_read_policy" ON public.football_predictions
FOR SELECT
TO authenticated, anon
USING (
    publication_status = 'published'
    AND (
        settlement_status = 'won'
        OR public.is_paid_subscriber()
    )
);


-- 3. HARDEN football_settlements RLS
-- Prevent scrapers from extracting all lost/void matches and notes
ALTER TABLE public.football_settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read football_settlements" ON public.football_settlements;
DROP POLICY IF EXISTS "settlements_read_policy" ON public.football_settlements;
DROP POLICY IF EXISTS "football_settlements_paywall_read_policy" ON public.football_settlements;

CREATE POLICY "football_settlements_paywall_read_policy" ON public.football_settlements
FOR SELECT
TO authenticated, anon
USING (
    status = 'won'
    OR public.is_paid_subscriber()
);


-- 4. HARDEN tennis_settlements & basketball_settlements RLS
-- Prevent scrapers from harvesting non-won multi-sport outcomes
ALTER TABLE public.tennis_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tennis_settlements_public_read" ON public.tennis_settlements;
DROP POLICY IF EXISTS "tennis_settlements_paywall_read_policy" ON public.tennis_settlements;

CREATE POLICY "tennis_settlements_paywall_read_policy" ON public.tennis_settlements
FOR SELECT
TO authenticated, anon
USING (
    status = 'won'
    OR public.is_paid_subscriber()
);

ALTER TABLE public.basketball_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "basketball_settlements_public_read" ON public.basketball_settlements;
DROP POLICY IF EXISTS "basketball_settlements_paywall_read_policy" ON public.basketball_settlements;

CREATE POLICY "basketball_settlements_paywall_read_policy" ON public.basketball_settlements
FOR SELECT
TO authenticated, anon
USING (
    status = 'won'
    OR public.is_paid_subscriber()
);


-- 5. HARDEN goals_settlements & decoupled specialist settlements RLS
ALTER TABLE public.goals_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "goals_settlements_public_read" ON public.goals_settlements;
DROP POLICY IF EXISTS "goals_settlements_paywall_read_policy" ON public.goals_settlements;

CREATE POLICY "goals_settlements_paywall_read_policy" ON public.goals_settlements
FOR SELECT
TO authenticated, anon
USING (
    status = 'won'
    OR public.is_paid_subscriber()
);

ALTER TABLE public.home_win_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "home_win_settlements_public_read" ON public.home_win_settlements;
CREATE POLICY "home_win_settlements_paywall_read_policy" ON public.home_win_settlements
FOR SELECT TO authenticated, anon
USING (status = 'won' OR public.is_paid_subscriber());

ALTER TABLE public.away_win_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "away_win_settlements_public_read" ON public.away_win_settlements;
CREATE POLICY "away_win_settlements_paywall_read_policy" ON public.away_win_settlements
FOR SELECT TO authenticated, anon
USING (status = 'won' OR public.is_paid_subscriber());

ALTER TABLE public.draw_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "draw_settlements_public_read" ON public.draw_settlements;
CREATE POLICY "draw_settlements_paywall_read_policy" ON public.draw_settlements
FOR SELECT TO authenticated, anon
USING (status = 'won' OR public.is_paid_subscriber());

ALTER TABLE public.corner_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "corner_settlements_public_read" ON public.corner_settlements;
CREATE POLICY "corner_settlements_paywall_read_policy" ON public.corner_settlements
FOR SELECT TO authenticated, anon
USING (status = 'won' OR public.is_paid_subscriber());
