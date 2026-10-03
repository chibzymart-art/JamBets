-- =====================================================================
-- Migration: 20261003000001_refine_tennis_paywall_view.sql
-- Refines public.tennis_predictions_paywall view to deliver structured
-- paywall teasers for free/unauthenticated users instead of empty '[]'::jsonb.
-- =====================================================================

DROP VIEW IF EXISTS public.tennis_predictions_paywall;
CREATE OR REPLACE VIEW public.tennis_predictions_paywall AS
SELECT
    p.id,
    p.fixture_id,
    p.market,
    CASE
        WHEN public.is_admin() THEN p.prediction
        WHEN public.is_paid_subscriber() THEN p.prediction
        WHEN p.settlement_status IN ('won', 'lost', 'void') THEN p.prediction
        WHEN f.status IN ('finished', 'retired', 'walkover') THEN p.prediction
        ELSE 'LOCKED'
    END AS prediction,
    CASE
        WHEN public.is_admin() THEN p.probability
        WHEN public.is_paid_subscriber() THEN p.probability
        WHEN p.settlement_status IN ('won', 'lost', 'void') THEN p.probability
        WHEN f.status IN ('finished', 'retired', 'walkover') THEN p.probability
        ELSE NULL
    END AS probability,
    CASE
        WHEN public.is_admin() THEN p.confidence_category
        WHEN public.is_paid_subscriber() THEN p.confidence_category
        WHEN p.settlement_status IN ('won', 'lost', 'void') THEN p.confidence_category
        WHEN f.status IN ('finished', 'retired', 'walkover') THEN p.confidence_category
        ELSE 'LOCKED'
    END AS confidence_category,
    CASE
        WHEN public.is_admin() THEN p.secondary_predictions
        WHEN public.is_paid_subscriber() THEN p.secondary_predictions
        WHEN p.settlement_status IN ('won', 'lost', 'void') THEN p.secondary_predictions
        WHEN f.status IN ('finished', 'retired', 'walkover') THEN p.secondary_predictions
        ELSE COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'market', elem->>'market',
                        'prediction', '🔒 VIP Banker',
                        'probability', null,
                        'locked', true
                    )
                )
                FROM jsonb_array_elements(p.secondary_predictions) AS elem
            ),
            jsonb_build_array(
                jsonb_build_object('market', 'game_handicap', 'prediction', '🔒 VIP Banker', 'probability', null, 'locked', true),
                jsonb_build_object('market', 'first_set_winner', 'prediction', '🔒 VIP Banker', 'probability', null, 'locked', true),
                jsonb_build_object('market', 'set_handicap', 'prediction', '🔒 VIP Banker', 'probability', null, 'locked', true),
                jsonb_build_object('market', 'total_games_over_under', 'prediction', '🔒 VIP Banker', 'probability', null, 'locked', true)
            )
        )
    END AS secondary_predictions,
    CASE
        WHEN public.is_admin() THEN p.metadata
        WHEN public.is_paid_subscriber() THEN p.metadata
        WHEN p.settlement_status IN ('won', 'lost', 'void') THEN p.metadata
        WHEN f.status IN ('finished', 'retired', 'walkover') THEN p.metadata
        ELSE jsonb_build_object(
            'surface', p.metadata->>'surface',
            'court_pace_index', p.metadata->>'court_pace_index',
            'simulations_count', p.simulations_count,
            'is_locked', true
        )
    END AS metadata,
    p.simulations_count,
    p.tier_required,
    p.publication_status,
    p.target_kickoff_at,
    p.settlement_status,
    p.settlement_notes,
    p.settled_at,
    p.actual_result,
    p.created_at,
    p.updated_at,
    CASE
        WHEN public.is_admin() THEN false
        WHEN public.is_paid_subscriber() THEN false
        WHEN p.settlement_status IN ('won', 'lost', 'void') THEN false
        WHEN f.status IN ('finished', 'retired', 'walkover') THEN false
        ELSE true
    END AS is_locked
FROM public.tennis_predictions p
JOIN public.tennis_fixtures f ON f.id = p.fixture_id
WHERE p.publication_status = 'published';

-- Enable View security permissions
GRANT SELECT ON public.tennis_predictions_paywall TO anon, authenticated, service_role;
