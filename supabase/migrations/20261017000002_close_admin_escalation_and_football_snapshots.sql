-- Migration: 20261017000002_close_admin_escalation_and_football_snapshots.sql
-- Description: two targeted security fixes.
--
-- 1. public.is_admin() must NOT accept auth.jwt() -> 'user_metadata' ->> 'role' = 'admin'.
--    user_metadata is user-editable (supabase.auth.updateUser), so any logged-in user could promote
--    themselves to admin at the database level (admin write policies, paywall views, entitlement
--    helpers). Real admins are still recognised by the admin e-mail allow-list, app_metadata.role
--    (server-only), public.users.role, and admin entitlements / subscriptions. The edit is applied to
--    the LIVE function definition so nothing else in the function changes; it aborts if the expected
--    clause is not found.
--
-- 2. cached_feeds snapshots for football (feed:football:today, feed:goals, feed:corners) were readable by
--    anyone through the REST API, bypassing the paywall. They now follow the football entitlement rule:
--    free trial (first 3 days) / Standard / BigBang VIP / Admin. 'won' proof data stays public through the
--    football tables themselves; the key feed:market:counts and every other key stay public.
--    The Edge feeds read these rows with the service role, which is unaffected.

-- 1. Remove the user_metadata admin shortcut from is_admin().
DO $$
DECLARE
  def     text;
  new_def text;
BEGIN
  def := pg_get_functiondef('public.is_admin()'::regprocedure);
  new_def := regexp_replace(
    def,
    '[(][[:space:]]*auth[.]jwt[(][)][[:space:]]*->[[:space:]]*''user_metadata''[[:space:]]*->>[[:space:]]*''role''[[:space:]]*[)][[:space:]]*=[[:space:]]*''admin''[[:space:]]*OR[[:space:]]*',
    '',
    'g'
  );
  IF new_def = def THEN
    RAISE EXCEPTION 'is_admin(): expected user_metadata clause not found; aborting without changes';
  END IF;
  IF new_def ~* 'user_metadata' THEN
    RAISE EXCEPTION 'is_admin(): user_metadata still referenced after rewrite; aborting without changes';
  END IF;
  EXECUTE new_def;
END;
$$;

-- 2. Football snapshots in cached_feeds follow the football entitlement; tennis/basketball keep the VIP gate.
ALTER POLICY "cached_feeds_public_read" ON public.cached_feeds
  USING (
    key <> ALL (ARRAY['feed:tennis', 'feed:basketball', 'feed:football:today', 'feed:goals', 'feed:corners'])
    OR (key IN ('feed:tennis', 'feed:basketball') AND public.is_multisport_entitled())
    OR (key IN ('feed:football:today', 'feed:goals', 'feed:corners') AND public.is_football_entitled())
  );

-- ROLLBACK (manual, if ever required):
--   ALTER POLICY "cached_feeds_public_read" ON public.cached_feeds
--     USING (key <> ALL (ARRAY['feed:tennis', 'feed:basketball']) OR public.is_multisport_entitled());
--   (is_admin(): restore the previous definition from 20261013000002_optimize_paywall_fast_path.sql -- NOT recommended,
--    it re-opens the self-promotion hole.)
