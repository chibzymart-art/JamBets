-- =====================================================================
-- JamBets / Oddsbanta — Phase 3: Post-Login Session Bootstrap RPC
-- Consolidates users, subscriptions, entitlements into a single atomic
-- roundtrip to absorb 5,000 concurrent user logins without database strain.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_user_session_bootstrap(p_user_id UUID DEFAULT auth.uid())
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_target_id UUID;
    v_user JSONB;
    v_sub JSONB;
    v_ent JSONB;
BEGIN
    -- Block anonymous snooping
    IF auth.role() = 'anon' THEN
        RAISE EXCEPTION 'Access denied: Anonymous sessions cannot bootstrap user profiles.';
    END IF;

    -- Determine target user ID (defaulting to caller's auth.uid())
    v_target_id := COALESCE(p_user_id, auth.uid());

    IF v_target_id IS NULL THEN
        RAISE EXCEPTION 'User ID required for session bootstrap.';
    END IF;

    -- Strict multi-tenant isolation: An authenticated user can only fetch their own session
    IF auth.role() = 'authenticated' AND auth.uid() IS NOT NULL AND auth.uid() <> v_target_id THEN
        IF NOT public.is_admin() THEN
            RAISE EXCEPTION 'Access denied: Cannot fetch session bootstrap for another user.';
        END IF;
    END IF;

    -- 1. Fetch user profile
    SELECT to_jsonb(u.*) INTO v_user
    FROM public.users u
    WHERE u.id = v_target_id;

    -- 2. Fetch latest subscription
    SELECT to_jsonb(s.*) INTO v_sub
    FROM public.subscriptions s
    WHERE s.user_id = v_target_id
    ORDER BY s.created_at DESC
    LIMIT 1;

    -- 3. Fetch latest entitlement
    SELECT to_jsonb(e.*) INTO v_ent
    FROM public.entitlements e
    WHERE e.user_id = v_target_id
    ORDER BY e.created_at DESC
    LIMIT 1;

    RETURN jsonb_build_object(
        'user', v_user,
        'subscription', v_sub,
        'entitlement', v_ent
    );
END;
$$;

-- Grant execution to authenticated users and backend service role
REVOKE EXECUTE ON FUNCTION public.get_user_session_bootstrap(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_user_session_bootstrap(UUID) TO authenticated, service_role;
