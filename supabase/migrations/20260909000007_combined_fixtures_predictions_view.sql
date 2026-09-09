-- =====================================================================
-- JamBets — Combined Fixtures & Predictions View Migration
-- Combines football_fixtures, leagues, teams, and football_predictions_paywall
-- into a single, performant view.
-- =====================================================================

DROP VIEW IF EXISTS public.football_fixtures_predictions_view CASCADE;

CREATE OR REPLACE VIEW public.football_fixtures_predictions_view AS
SELECT
    f.id,
    f.canonical_key,
    f.target_kickoff_at,
    f.status,
    f.queue_day,
    f.in_prediction_queue,
    f.home_score,
    f.away_score,
    f.match_minute,
    f.period,
    f.half_time_home_score,
    f.half_time_away_score,
    f.corners_home,
    f.corners_away,
    f.created_at,
    f.updated_at,
    l.id AS league_id,
    l.name AS league_name,
    l.code AS league_code,
    l.country AS league_country,
    ht.id AS home_team_id,
    ht.name AS home_team_name,
    at.id AS away_team_id,
    at.name AS away_team_name,
    p.id AS prediction_id,
    p.market AS prediction_market,
    p.prediction,
    p.probability,
    p.confidence_category,
    p.secondary_predictions,
    p.publication_status,
    p.tier_required,
    p.is_locked,
    p.settlement_status,
    p.settlement_notes,
    p.actual_score,
    p.simulations_count
FROM public.football_fixtures f
JOIN public.football_leagues l ON f.league_id = l.id
JOIN public.football_teams ht ON f.home_team_id = ht.id
JOIN public.football_teams at ON f.away_team_id = at.id
LEFT JOIN public.football_predictions_paywall p ON p.fixture_id = f.id
WHERE f.in_prediction_queue = true
ORDER BY f.target_kickoff_at ASC;

GRANT SELECT ON public.football_fixtures_predictions_view TO anon, authenticated, service_role;
