-- Migration: 20261017000001_multisport_vip_only_db_gate.sql
-- Description: Database-layer gate for TENNIS + BASKETBALL = BigBang VIP + Admin ONLY.
--
--   Free trial / Standard / Expired / Visitor : no access to tennis / basketball prediction data
--   BigBang VIP                               : full access
--   Admin                                     : full access
--
-- Why: until now the DB gates for these two sports used is_paid_subscriber(), which includes the
-- Standard tier, and the public cached_feeds snapshot table exposed the full unlocked tennis and
-- basketball feeds to anyone (even logged-out visitors) through the Supabase REST API.
--
-- Scope (nothing else is touched): football / goals / corners objects, users, subscriptions,
-- entitlements, is_admin() and is_paid_subscriber() are NOT modified.
-- The Edge feeds read these sources with the service role, which this gate always allows.

-- 1. Single source of truth for the multi-sport gate.
--    Admin detection deliberately does NOT trust user_metadata (it is user-editable).
CREATE OR REPLACE FUNCTION public.is_multisport_entitled()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
BEGIN
  IF (auth.jwt() ->> 'role') = 'service_role' THEN
    RETURN true;
  END IF;

  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  IF v_email IN (
    'chibzymart@gmail.com',
    'whizzchibz@gmail.com',
    'chibuezec.amuchie@gmail.com',
    'chibuezeamuchie@gmail.com',
    'nnamdiamuchie@gmail.com'
  ) THEN
    RETURN true;
  END IF;

  IF (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = v_uid
      AND lower(coalesce(u.role, '')) IN ('admin', 'bigbang', 'big_bang', 'vip', 'pro', 'premium')
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.entitlements e
    WHERE e.user_id = v_uid
      AND (e.tier IN ('admin', 'bigbang', 'big_bang', 'vip', 'pro', 'premium') OR (e.features ->> 'admin') = 'true')
      AND (e.valid_until IS NULL OR e.valid_until > now())
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.user_id = v_uid
      AND s.status = 'active'
      AND s.tier IN ('admin', 'bigbang', 'big_bang', 'vip', 'pro', 'premium')
      AND (s.current_period_end IS NULL OR s.current_period_end > now())
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_multisport_entitled() TO anon, authenticated, service_role;

-- 2. Raw prediction tables: VIP + Admin only (was: admin OR is_paid_subscriber() OR standard entitlement).
ALTER POLICY "tennis_predictions_paid_read" ON public.tennis_predictions
  USING (public.is_multisport_entitled());

ALTER POLICY "basketball_predictions_paid_read" ON public.basketball_predictions
  USING (public.is_multisport_entitled());

-- 3. Settlement tables: public keeps seeing 'won' proof rows; the lost/void rows become VIP + Admin only.
ALTER POLICY "tennis_settlements_paywall_read_policy" ON public.tennis_settlements
  USING (status = 'won' OR public.is_multisport_entitled());

ALTER POLICY "basketball_settlements_paywall_read_policy" ON public.basketball_settlements
  USING (status = 'won' OR public.is_multisport_entitled());

-- 4. Pre-computed Edge snapshots: only the two multi-sport keys are restricted; every other key stays public.
ALTER POLICY "cached_feeds_public_read" ON public.cached_feeds
  USING (key NOT IN ('feed:tennis', 'feed:basketball') OR public.is_multisport_entitled());

-- 5. Paywall views: keep the existing definition (columns, redaction rules, settled-row behaviour) and
--    only swap the entitlement checks to the multi-sport gate. Done dynamically so the live definition
--    is preserved exactly.
DO $$
DECLARE
  v   text;
  def text;
BEGIN
  FOREACH v IN ARRAY ARRAY['tennis_predictions_paywall', 'basketball_predictions_paywall'] LOOP
    def := pg_get_viewdef(('public.' || v)::regclass, true);
    IF def ~ 'is_(paid_subscriber|admin)\(\)' THEN
      def := regexp_replace(def, '(public\.)?is_(paid_subscriber|admin)\(\)', 'public.is_multisport_entitled()', 'g');
      EXECUTE format('CREATE OR REPLACE VIEW public.%I AS %s', v, rtrim(def, E';\n '));
    END IF;
  END LOOP;
END;
$$;

-- ROLLBACK (manual, if ever required):
--   ALTER POLICY "tennis_predictions_paid_read" ON public.tennis_predictions USING (public.is_admin() OR public.is_paid_subscriber());
--   ALTER POLICY "basketball_predictions_paid_read" ON public.basketball_predictions USING (public.is_admin() OR public.is_paid_subscriber());
--   ALTER POLICY "tennis_settlements_paywall_read_policy" ON public.tennis_settlements USING (status = 'won' OR public.is_paid_subscriber());
--   ALTER POLICY "basketball_settlements_paywall_read_policy" ON public.basketball_settlements USING (status = 'won' OR public.is_paid_subscriber());
--   ALTER POLICY "cached_feeds_public_read" ON public.cached_feeds USING (true);
--   (views: re-run the DO block with the regexp reversed: 'public.is_multisport_entitled()' -> 'public.is_paid_subscriber()')
