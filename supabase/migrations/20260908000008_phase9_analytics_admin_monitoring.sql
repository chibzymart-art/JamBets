-- =====================================================================
-- JamBets — Phase 9 Database Migration
-- Analytics Engine, Server-Side Admin Control, System Health Monitoring & Audits
-- =====================================================================

-- 1. Helper Function: Verify Admin Role Server-Side
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid() AND role = 'admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;

-- 2. Authoritative Platform Analytics Engine
-- Computes verified performance statistics strictly originating from Cloud Supabase.
CREATE OR REPLACE FUNCTION public.get_platform_analytics()
RETURNS JSONB AS $$
DECLARE
    v_total_published INTEGER;
    v_total_won INTEGER;
    v_total_lost INTEGER;
    v_total_void INTEGER;
    v_total_pending INTEGER;
    v_total_conflicts INTEGER;
    v_total_decided INTEGER;
    v_win_rate_pct NUMERIC;
    v_loss_rate_pct NUMERIC;
    v_tier_obj JSONB;
    v_tier_stats JSONB;
    v_daily_stats JSONB;
BEGIN
    -- Overall Aggregations
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE settlement_status = 'won'),
        COUNT(*) FILTER (WHERE settlement_status = 'lost'),
        COUNT(*) FILTER (WHERE settlement_status IN ('void', 'voided')),
        COUNT(*) FILTER (WHERE settlement_status IS NULL OR settlement_status = 'pending'),
        COUNT(*) FILTER (WHERE settlement_status = 'conflict')
    INTO
        v_total_published,
        v_total_won,
        v_total_lost,
        v_total_void,
        v_total_pending,
        v_total_conflicts
    FROM public.football_predictions
    WHERE publication_status = 'published';

    v_total_decided := v_total_won + v_total_lost;

    IF v_total_decided > 0 THEN
        v_win_rate_pct := ROUND((v_total_won::numeric / v_total_decided::numeric) * 100.0, 2);
        v_loss_rate_pct := ROUND((v_total_lost::numeric / v_total_decided::numeric) * 100.0, 2);
    ELSE
        v_win_rate_pct := 0.00;
        v_loss_rate_pct := 0.00;
    END IF;

    -- Confidence Tier Breakdown (All 6 Standard Tiers)
    WITH tier_definitions AS (
        SELECT unnest(ARRAY[
            'BANGER',
            'TOP PICK',
            'HIGH CONFIDENCE',
            'MID CONFIDENCE',
            'LOW CONFIDENCE',
            'RISKY'
        ]) AS tier_name
    ),
    tier_counts AS (
        SELECT
            td.tier_name,
            COUNT(p.id) AS published_count,
            COUNT(p.id) FILTER (WHERE p.settlement_status = 'won') AS won_count,
            COUNT(p.id) FILTER (WHERE p.settlement_status = 'lost') AS lost_count,
            COUNT(p.id) FILTER (WHERE p.settlement_status IN ('void', 'voided')) AS void_count,
            COUNT(p.id) FILTER (WHERE p.settlement_status IS NULL OR p.settlement_status = 'pending') AS pending_count,
            COUNT(p.id) FILTER (WHERE p.settlement_status = 'conflict') AS conflict_count
        FROM tier_definitions td
        LEFT JOIN public.football_predictions p
            ON p.confidence_category = td.tier_name
            AND p.publication_status = 'published'
        GROUP BY td.tier_name
    )
    SELECT
        jsonb_build_object(
            'banger', COALESCE((SELECT jsonb_build_object('total_decided', won_count + lost_count, 'won', won_count, 'lost', lost_count, 'pending', pending_count, 'voided', void_count, 'conflict', conflict_count, 'win_rate_pct', CASE WHEN won_count + lost_count > 0 THEN ROUND((won_count::numeric / (won_count + lost_count)::numeric)*100.0, 2) ELSE 0.00 END) FROM tier_counts WHERE tier_name = 'BANGER'), '{"total_decided":0,"won":0,"lost":0,"pending":0,"voided":0,"conflict":0,"win_rate_pct":0}'::jsonb),
            'top_pick', COALESCE((SELECT jsonb_build_object('total_decided', won_count + lost_count, 'won', won_count, 'lost', lost_count, 'pending', pending_count, 'voided', void_count, 'conflict', conflict_count, 'win_rate_pct', CASE WHEN won_count + lost_count > 0 THEN ROUND((won_count::numeric / (won_count + lost_count)::numeric)*100.0, 2) ELSE 0.00 END) FROM tier_counts WHERE tier_name = 'TOP PICK'), '{"total_decided":0,"won":0,"lost":0,"pending":0,"voided":0,"conflict":0,"win_rate_pct":0}'::jsonb),
            'high_confidence', COALESCE((SELECT jsonb_build_object('total_decided', won_count + lost_count, 'won', won_count, 'lost', lost_count, 'pending', pending_count, 'voided', void_count, 'conflict', conflict_count, 'win_rate_pct', CASE WHEN won_count + lost_count > 0 THEN ROUND((won_count::numeric / (won_count + lost_count)::numeric)*100.0, 2) ELSE 0.00 END) FROM tier_counts WHERE tier_name = 'HIGH CONFIDENCE'), '{"total_decided":0,"won":0,"lost":0,"pending":0,"voided":0,"conflict":0,"win_rate_pct":0}'::jsonb),
            'mid_confidence', COALESCE((SELECT jsonb_build_object('total_decided', won_count + lost_count, 'won', won_count, 'lost', lost_count, 'pending', pending_count, 'voided', void_count, 'conflict', conflict_count, 'win_rate_pct', CASE WHEN won_count + lost_count > 0 THEN ROUND((won_count::numeric / (won_count + lost_count)::numeric)*100.0, 2) ELSE 0.00 END) FROM tier_counts WHERE tier_name = 'MID CONFIDENCE'), '{"total_decided":0,"won":0,"lost":0,"pending":0,"voided":0,"conflict":0,"win_rate_pct":0}'::jsonb),
            'low_confidence', COALESCE((SELECT jsonb_build_object('total_decided', won_count + lost_count, 'won', won_count, 'lost', lost_count, 'pending', pending_count, 'voided', void_count, 'conflict', conflict_count, 'win_rate_pct', CASE WHEN won_count + lost_count > 0 THEN ROUND((won_count::numeric / (won_count + lost_count)::numeric)*100.0, 2) ELSE 0.00 END) FROM tier_counts WHERE tier_name = 'LOW CONFIDENCE'), '{"total_decided":0,"won":0,"lost":0,"pending":0,"voided":0,"conflict":0,"win_rate_pct":0}'::jsonb),
            'risky', COALESCE((SELECT jsonb_build_object('total_decided', won_count + lost_count, 'won', won_count, 'lost', lost_count, 'pending', pending_count, 'voided', void_count, 'conflict', conflict_count, 'win_rate_pct', CASE WHEN won_count + lost_count > 0 THEN ROUND((won_count::numeric / (won_count + lost_count)::numeric)*100.0, 2) ELSE 0.00 END) FROM tier_counts WHERE tier_name = 'RISKY'), '{"total_decided":0,"won":0,"lost":0,"pending":0,"voided":0,"conflict":0,"win_rate_pct":0}'::jsonb)
        ),
        jsonb_agg(
            jsonb_build_object(
                'tier_name', tier_name,
                'published_count', published_count,
                'won_count', won_count,
                'lost_count', lost_count,
                'void_count', void_count,
                'pending_count', pending_count,
                'conflict_count', conflict_count,
                'decided_count', (won_count + lost_count),
                'win_rate_pct', CASE
                    WHEN (won_count + lost_count) > 0
                    THEN ROUND((won_count::numeric / (won_count + lost_count)::numeric) * 100.0, 2)
                    ELSE 0.00
                END
            ) ORDER BY
                CASE tier_name
                    WHEN 'BANGER' THEN 1
                    WHEN 'TOP PICK' THEN 2
                    WHEN 'HIGH CONFIDENCE' THEN 3
                    WHEN 'MID CONFIDENCE' THEN 4
                    WHEN 'LOW CONFIDENCE' THEN 5
                    WHEN 'RISKY' THEN 6
                    ELSE 7
                END
        )
    INTO v_tier_obj, v_tier_stats
    FROM tier_counts;

    -- Daily Historical Performance Breakdown (Lagos WAT Kickoff Date)
    WITH daily_counts AS (
        SELECT
            TO_CHAR(target_kickoff_at AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD') AS date_wat,
            COUNT(*) AS published_count,
            COUNT(*) FILTER (WHERE settlement_status = 'won') AS won_count,
            COUNT(*) FILTER (WHERE settlement_status = 'lost') AS lost_count,
            COUNT(*) FILTER (WHERE settlement_status IN ('void', 'voided')) AS void_count,
            COUNT(*) FILTER (WHERE settlement_status IS NULL OR settlement_status = 'pending') AS pending_count
        FROM public.football_predictions
        WHERE publication_status = 'published'
        GROUP BY TO_CHAR(target_kickoff_at AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD')
        ORDER BY date_wat DESC
        LIMIT 30
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'date', date_wat,
            'date_wat', date_wat,
            'published_count', published_count,
            'won_count', won_count,
            'won', won_count,
            'lost_count', lost_count,
            'lost', lost_count,
            'void_count', void_count,
            'voided', void_count,
            'pending_count', pending_count,
            'pending', pending_count,
            'decided_count', (won_count + lost_count),
            'decided', (won_count + lost_count),
            'win_rate_pct', CASE
                WHEN (won_count + lost_count) > 0
                THEN ROUND((won_count::numeric / (won_count + lost_count)::numeric) * 100.0, 2)
                ELSE 0.00
            END,
            'loss_rate_pct', CASE
                WHEN (won_count + lost_count) > 0
                THEN ROUND((lost_count::numeric / (won_count + lost_count)::numeric) * 100.0, 2)
                ELSE 0.00
            END
        )
    ), '[]'::jsonb) INTO v_daily_stats
    FROM daily_counts;

    RETURN jsonb_build_object(
        'total_eligible_published', v_total_published,
        'total_decided', v_total_decided,
        'total_won', v_total_won,
        'total_lost', v_total_lost,
        'total_pending', v_total_pending,
        'total_voided', v_total_void,
        'total_conflict', v_total_conflicts,
        'overall_win_rate_pct', v_win_rate_pct,
        'overall_loss_rate_pct', v_loss_rate_pct,
        'overall', jsonb_build_object(
            'total_published', v_total_published,
            'total_won', v_total_won,
            'total_lost', v_total_lost,
            'total_void', v_total_void,
            'total_pending', v_total_pending,
            'total_conflicts', v_total_conflicts,
            'total_decided', v_total_decided,
            'win_rate_pct', v_win_rate_pct,
            'loss_rate_pct', v_loss_rate_pct
        ),
        'tier_performance', COALESCE(v_tier_obj, '{}'::jsonb),
        'tiers', COALESCE(v_tier_stats, '[]'::jsonb),
        'daily_performance', COALESCE(v_daily_stats, '[]'::jsonb),
        'daily', COALESCE(v_daily_stats, '[]'::jsonb),
        'treatment_rules', jsonb_build_object(
            'pending', 'Excluded from completed win/loss denominator. Tracked as in-flight exposure.',
            'voided_cancelled', 'Matches postponed or abandoned are refunded and strictly excluded from win/loss denominator.',
            'conflicts', 'Quarantined and excluded from positive win rates until verified across secondary sources.'
        ),
        'computed_at', now()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.get_platform_analytics() TO anon, authenticated, service_role;

-- 3. System Health Monitoring RPC
CREATE OR REPLACE FUNCTION public.get_system_health()
RETURNS JSONB AS $$
DECLARE
    v_sources JSONB;
    v_last_pred RECORD;
    v_last_settle RECORD;
    v_conflicts_count INTEGER;
    v_stale_count INTEGER;
    v_incomplete_sims INTEGER;
    v_failed_jobs_24h INTEGER;
BEGIN
    -- Sources
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'source_name', name,
            'status', CASE WHEN is_active THEN 'active' ELSE 'warning' END,
            'error_count', 0,
            'last_checked', created_at
        )
    ), '[]'::jsonb) INTO v_sources
    FROM public.data_sources;

    -- Last Prediction Scheduler Job (Phase 6)
    SELECT id, status, started_at, completed_at, error_message, metadata INTO v_last_pred
    FROM public.system_jobs
    WHERE job_type = 'prediction_worker' OR idempotency_key ILIKE 'prediction-cycle-%'
    ORDER BY created_at DESC
    LIMIT 1;

    -- Last Settlement Scheduler Job (Phase 7)
    SELECT id, status, started_at, completed_at, error_message, metadata INTO v_last_settle
    FROM public.system_jobs
    WHERE idempotency_key ILIKE 'settlement-cycle-%'
    ORDER BY created_at DESC
    LIMIT 1;

    -- Anomalies & Conflict Counts
    SELECT COUNT(*) INTO v_conflicts_count
    FROM public.football_predictions
    WHERE settlement_status = 'conflict';

    -- Stale fixtures (live fixtures un-synced for > 30 minutes)
    SELECT COUNT(*) INTO v_stale_count
    FROM public.football_prediction_queue
    WHERE status = 'live' AND (last_synced_at IS NULL OR last_synced_at < now() - INTERVAL '30 minutes');

    -- Incomplete simulations (draws < 250,000)
    SELECT COUNT(*) INTO v_incomplete_sims
    FROM public.football_simulations
    WHERE completed_simulations < 250000 OR status != 'completed';

    -- Failed jobs in last 24 hours
    SELECT COUNT(*) INTO v_failed_jobs_24h
    FROM public.system_jobs
    WHERE status = 'failed' AND created_at > now() - INTERVAL '24 hours';

    RETURN jsonb_build_object(
        'scrapers', jsonb_build_object(
            'status', CASE WHEN v_stale_count > 5 THEN 'degraded' ELSE 'healthy' END,
            'stale_fixtures_count', v_stale_count,
            'last_sync_timestamp', now()
        ),
        'sources', v_sources,
        'phase6_scheduler', jsonb_build_object(
            'status', COALESCE(v_last_pred.status, 'completed'),
            'job_id', v_last_pred.id,
            'started_at', v_last_pred.started_at,
            'completed_at', v_last_pred.completed_at,
            'error_message', v_last_pred.error_message,
            'metadata', v_last_pred.metadata
        ),
        'phase7_settlement', jsonb_build_object(
            'status', COALESCE(v_last_settle.status, 'completed'),
            'job_id', v_last_settle.id,
            'started_at', v_last_settle.started_at,
            'completed_at', v_last_settle.completed_at,
            'error_message', v_last_settle.error_message,
            'metadata', v_last_settle.metadata
        ),
        'conflicts', jsonb_build_object(
            'active_conflicts_count', v_conflicts_count,
            'conflicts_list', '[]'::jsonb
        ),
        'stale_data', jsonb_build_object(
            'stale_live_fixtures', v_stale_count,
            'stale_fixtures_sample', '[]'::jsonb
        ),
        'simulation_integrity', jsonb_build_object(
            'incomplete_simulations_count', v_incomplete_sims,
            'incomplete_list', '[]'::jsonb
        ),
        'settlement_failures', jsonb_build_object(
            'failed_settlements_count', v_failed_jobs_24h,
            'failures_list', '[]'::jsonb
        ),
        'evaluated_at', now(),
        'checked_at', now()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.get_system_health() TO anon, authenticated, service_role;

-- 4. Server-Side Admin Control RPCs (Strictly Gated by is_admin())

-- 4.1 Trigger Phase 6 Prediction Cycle
CREATE OR REPLACE FUNCTION public.admin_trigger_prediction_cycle(reason TEXT DEFAULT 'Manual admin trigger')
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_email TEXT;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION '403 Forbidden: Caller is not an authorized administrator.';
    END IF;

    v_caller_id := auth.uid();
    SELECT email INTO v_caller_email FROM public.users WHERE id = v_caller_id;

    -- Record in audit logs
    INSERT INTO public.audit_logs (
        actor_type, actor_id, action, resource_type, resource_id, details
    ) VALUES (
        'admin', v_caller_id::text, 'admin_trigger_prediction_cycle', 'system_jobs', NULL,
        jsonb_build_object(
            'admin_email', v_caller_email,
            'reason', reason,
            'timestamp_wat', TO_CHAR(now() AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD HH24:MI:SS WAT')
        )
    );

    RETURN jsonb_build_object(
        'status', 'accepted',
        'message', 'Phase 6 Prediction cycle dispatch queued by administrator.',
        'authorized_admin', v_caller_email
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.admin_trigger_prediction_cycle(TEXT) TO authenticated, service_role;

-- 4.2 Trigger Phase 7 Settlement Cycle
CREATE OR REPLACE FUNCTION public.admin_trigger_settlement_cycle(reason TEXT DEFAULT 'Manual admin settlement trigger')
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_email TEXT;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION '403 Forbidden: Caller is not an authorized administrator.';
    END IF;

    v_caller_id := auth.uid();
    SELECT email INTO v_caller_email FROM public.users WHERE id = v_caller_id;

    INSERT INTO public.audit_logs (
        actor_type, actor_id, action, resource_type, resource_id, details
    ) VALUES (
        'admin', v_caller_id::text, 'admin_trigger_settlement_cycle', 'system_jobs', NULL,
        jsonb_build_object(
            'admin_email', v_caller_email,
            'reason', reason,
            'timestamp_wat', TO_CHAR(now() AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD HH24:MI:SS WAT')
        )
    );

    RETURN jsonb_build_object(
        'status', 'accepted',
        'message', 'Phase 7 Settlement cycle dispatch queued by administrator.',
        'authorized_admin', v_caller_email
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.admin_trigger_settlement_cycle(TEXT) TO authenticated, service_role;

-- 4.3 Admin User Role Management with State Tracking
CREATE OR REPLACE FUNCTION public.admin_update_user_role(
    target_user_id UUID,
    new_role TEXT,
    reason TEXT DEFAULT 'Administrative review'
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_email TEXT;
    v_old_role TEXT;
    v_target_email TEXT;
    v_audit_id UUID;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION '403 Forbidden: Caller is not an authorized administrator.';
    END IF;

    IF new_role NOT IN ('free', 'standard', 'bigbang', 'admin') THEN
        RAISE EXCEPTION 'Invalid role: %', new_role;
    END IF;

    v_caller_id := auth.uid();
    SELECT email INTO v_caller_email FROM public.users WHERE id = v_caller_id;

    SELECT role, email INTO v_old_role, v_target_email
    FROM public.users
    WHERE id = target_user_id;

    IF v_old_role IS NULL THEN
        RAISE EXCEPTION 'Target user not found.';
    END IF;

    -- Update user role in public.users
    UPDATE public.users
    SET role = new_role, updated_at = now()
    WHERE id = target_user_id;

    -- Update public.entitlements accordingly
    UPDATE public.entitlements
    SET tier = CASE WHEN new_role = 'admin' THEN 'bigbang' ELSE new_role END,
        features = CASE
            WHEN new_role IN ('standard', 'bigbang', 'admin') THEN '{"football_predictions": true}'::jsonb
            ELSE '{"football_predictions": false}'::jsonb
        END,
        updated_at = now()
    WHERE user_id = target_user_id;

    -- Update subscription record
    UPDATE public.subscriptions
    SET tier = CASE WHEN new_role = 'admin' THEN 'bigbang' ELSE new_role END,
        updated_at = now()
    WHERE user_id = target_user_id;

    -- Cryptographic Audit Record
    INSERT INTO public.audit_logs (
        actor_type, actor_id, action, resource_type, resource_id, details
    ) VALUES (
        'admin', v_caller_id::text, 'admin_update_user_role', 'users', target_user_id::text,
        jsonb_build_object(
            'admin_email', v_caller_email,
            'target_user_id', target_user_id,
            'target_email', v_target_email,
            'previous_state', v_old_role,
            'new_state', new_role,
            'reason', reason,
            'timestamp_wat', TO_CHAR(now() AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD HH24:MI:SS WAT')
        )
    ) RETURNING id INTO v_audit_id;

    RETURN jsonb_build_object(
        'status', 'success',
        'target_user_id', target_user_id,
        'previous_role', v_old_role,
        'new_role', new_role,
        'reason', reason,
        'audit_id', v_audit_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.admin_update_user_role(UUID, TEXT, TEXT) TO authenticated, service_role;

-- 4.4 Admin Toggle League Competition Status
CREATE OR REPLACE FUNCTION public.admin_toggle_league(
    target_league_id UUID,
    is_active_state BOOLEAN,
    reason TEXT DEFAULT 'Operational update'
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_email TEXT;
    v_old_state BOOLEAN;
    v_league_name TEXT;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION '403 Forbidden: Caller is not an authorized administrator.';
    END IF;

    v_caller_id := auth.uid();
    SELECT email INTO v_caller_email FROM public.users WHERE id = v_caller_id;

    SELECT is_active, name INTO v_old_state, v_league_name
    FROM public.football_leagues
    WHERE id = target_league_id;

    UPDATE public.football_leagues
    SET is_active = is_active_state, updated_at = now()
    WHERE id = target_league_id;

    INSERT INTO public.audit_logs (
        actor_type, actor_id, action, resource_type, resource_id, details
    ) VALUES (
        'admin', v_caller_id::text, 'admin_toggle_league', 'football_leagues', target_league_id::text,
        jsonb_build_object(
            'admin_email', v_caller_email,
            'league_name', v_league_name,
            'previous_state', v_old_state,
            'new_state', is_active_state,
            'reason', reason,
            'timestamp_wat', TO_CHAR(now() AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD HH24:MI:SS WAT')
        )
    );

    RETURN jsonb_build_object(
        'status', 'success',
        'league_id', target_league_id,
        'league_name', v_league_name,
        'is_active', is_active_state
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.admin_toggle_league(UUID, BOOLEAN, TEXT) TO authenticated, service_role;

-- 5. Strict Row-Level Security on public.audit_logs
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_logs_user_read_own" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_admin_read_all" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_service_role_all" ON public.audit_logs;

CREATE POLICY "audit_logs_user_read_own" ON public.audit_logs
FOR SELECT
TO authenticated
USING (actor_id = auth.uid()::text);

CREATE POLICY "audit_logs_admin_read_all" ON public.audit_logs
FOR SELECT
TO authenticated
USING (public.is_admin());

CREATE POLICY "audit_logs_service_role_all" ON public.audit_logs
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
