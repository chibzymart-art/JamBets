-- =====================================================================
-- JamBets Paywall & RLS Protection Migration
-- Redacts active prediction details for unauthenticated/free users at the database level.
-- Settled matches remain 100% public for historical win rate transparency.
-- =====================================================================

-- 1. Helper function to check if current user has active paid entitlement or admin role
CREATE OR REPLACE FUNCTION public.is_paid_subscriber()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT true
    FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'admin'
  ), (
    SELECT true
    FROM public.entitlements e
    WHERE e.user_id = auth.uid()
      AND e.tier IN ('standard', 'bigbang', 'pro', 'premium')
      AND (e.valid_until IS NULL OR e.valid_until > now())
    LIMIT 1
  ), (
    SELECT true
    FROM public.subscriptions s
    WHERE s.user_id = auth.uid()
      AND s.status = 'active'
      AND s.tier IN ('standard', 'bigbang', 'pro', 'premium')
    LIMIT 1
  ), false);
$$;

GRANT EXECUTE ON FUNCTION public.is_paid_subscriber() TO anon, authenticated;

-- 2. Create the secure paywalled view
DROP VIEW IF EXISTS public.football_predictions_paywall;

CREATE OR REPLACE VIEW public.football_predictions_paywall AS
SELECT
    p.id,
    p.fixture_id,
    p.simulation_id,
    p.market,
    CASE
        WHEN p.settlement_status IN ('won', 'lost', 'void', 'refunded', 'settled') THEN p.prediction
        WHEN f.status IN ('settled', 'finished', 'ft', 'aet', 'pen') THEN p.prediction
        WHEN public.is_paid_subscriber() THEN p.prediction
        ELSE NULL
    END AS prediction,
    CASE
        WHEN p.settlement_status IN ('won', 'lost', 'void', 'refunded', 'settled') THEN p.probability
        WHEN f.status IN ('settled', 'finished', 'ft', 'aet', 'pen') THEN p.probability
        WHEN public.is_paid_subscriber() THEN p.probability
        ELSE NULL
    END AS probability,
    CASE
        WHEN p.settlement_status IN ('won', 'lost', 'void', 'refunded', 'settled') THEN p.secondary_predictions
        WHEN f.status IN ('settled', 'finished', 'ft', 'aet', 'pen') THEN p.secondary_predictions
        WHEN public.is_paid_subscriber() THEN p.secondary_predictions
        ELSE NULL
    END AS secondary_predictions,
    CASE
        WHEN p.settlement_status IN ('won', 'lost', 'void', 'refunded', 'settled') THEN p.confidence_category
        WHEN f.status IN ('settled', 'finished', 'ft', 'aet', 'pen') THEN p.confidence_category
        WHEN public.is_paid_subscriber() THEN p.confidence_category
        ELSE 'LOCKED'
    END AS confidence_category,
    p.publication_status,
    p.tier_required,
    p.source_data_version,
    p.metadata,
    p.target_kickoff_at,
    p.settlement_status,
    p.settled_at,
    p.settlement_notes,
    p.actual_score,
    p.simulations_count,
    p.created_at,
    p.updated_at,
    CASE
        WHEN p.settlement_status IN ('won', 'lost', 'void', 'refunded', 'settled') THEN false
        WHEN f.status IN ('settled', 'finished', 'ft', 'aet', 'pen') THEN false
        WHEN public.is_paid_subscriber() THEN false
        ELSE true
    END AS is_locked
FROM public.football_predictions p
LEFT JOIN public.football_fixtures f ON p.fixture_id = f.id
WHERE p.publication_status = 'published';

GRANT SELECT ON public.football_predictions_paywall TO anon, authenticated;

-- 3. Row Level Security on base table to prevent direct payload interception
ALTER TABLE public.football_predictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "predictions_entitled_read_policy" ON public.football_predictions;
DROP POLICY IF EXISTS "predictions_paywall_read_policy" ON public.football_predictions;

CREATE POLICY "predictions_paywall_read_policy" ON public.football_predictions
FOR SELECT
TO authenticated, anon
USING (
    publication_status = 'published'
    AND (
        settlement_status IN ('won', 'lost', 'void', 'refunded', 'settled')
        OR public.is_paid_subscriber()
    )
);
