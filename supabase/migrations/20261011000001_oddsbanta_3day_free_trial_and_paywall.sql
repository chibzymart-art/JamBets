-- Migration: 20261011000001_oddsbanta_3day_free_trial_and_paywall.sql
-- Description: Oddsbanta 3-Day Free Trial on football predictions (database layer of the entitlement matrix)
--
--   visitor / expired trial : only 'won' proof rows
--   free account <= 72h     : FULL football access (trial)
--   Standard / BigBang VIP  : FULL football access
--   Admin                   : everything
--
-- Trial is derived from the VERIFIED auth account creation date (identical rule to the Edge verifier and the
-- web client), so it requires no extra rows, no new tier values and cannot desync from provisioning triggers.
--
-- NOTE: This file is ADDITIVE ONLY (CREATE OR REPLACE FUNCTION + one policy swap). It deliberately does NOT
-- rewrite handle_new_user() and does NOT backfill/mutate any existing subscriptions or entitlements rows.
-- It must NOT widen tennis / basketball access: those tables keep using is_paid_subscriber().

CREATE OR REPLACE FUNCTION public.is_football_entitled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(public.is_admin(), false)
    OR COALESCE(public.is_paid_subscriber(), false)
    OR EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND lower(coalesce(u.role, '')) IN ('standard', 'bigbang', 'vip', 'pro', 'premium', 'admin')
    )
    OR EXISTS (
      SELECT 1 FROM auth.users au
      WHERE au.id = auth.uid()
        AND au.created_at > (now() - INTERVAL '3 days')
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_football_entitled() TO anon, authenticated, service_role;

-- football_predictions: visitors/expired keep 'won' proof only; trial + Standard + VIP + Admin read everything
ALTER TABLE public.football_predictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "predictions_paywall_read_policy" ON public.football_predictions;

CREATE POLICY "predictions_paywall_read_policy" ON public.football_predictions
FOR SELECT
TO authenticated, anon
USING (
    publication_status = 'published'
    AND (
        settlement_status = 'won'
        OR public.is_football_entitled()
    )
);
