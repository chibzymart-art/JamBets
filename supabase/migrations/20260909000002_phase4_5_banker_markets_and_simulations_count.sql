-- JamBets Phase 4.5: High-Accuracy Banker Engine Schema Updates
-- Adds simulations_count, expands market check for ultra-safe banker markets & NO_SAFE_BANKER, and updates confidence category check.

-- 1. Add simulations_count column if not exists
ALTER TABLE public.football_predictions
  ADD COLUMN IF NOT EXISTS simulations_count INTEGER NOT NULL DEFAULT 250000;

-- 2. Expand market check constraint
ALTER TABLE public.football_predictions
  DROP CONSTRAINT IF EXISTS football_predictions_market_check;

ALTER TABLE public.football_predictions
  ADD CONSTRAINT football_predictions_market_check
  CHECK (market IN (
    '1x2', 'double_chance', 'btts', 'both_teams_to_score', 'correct_score',
    'over_under_0.5', 'over_under_1.5', 'over_under_2.5', 'over_under_3.5', 'over_under_4.5',
    'ht_result', 'ht_goals_0.5', 'ht_goals_1.5', '2h_goals_0.5', '2h_goals_1.5',
    'home_goals_0.5', 'away_goals_0.5',
    'corners', 'corners_8.5', 'corners_9.5', 'corners_10.5',
    'NO_SAFE_BANKER', 'no_safe_banker'
  ));

-- 3. Expand confidence_category check constraint
ALTER TABLE public.football_predictions
  DROP CONSTRAINT IF EXISTS football_predictions_confidence_category_check;

ALTER TABLE public.football_predictions
  ADD CONSTRAINT football_predictions_confidence_category_check
  CHECK (confidence_category IN (
    'BANGER', 'TOP PICK', 'HIGH CONFIDENCE', 'MID CONFIDENCE', 'LOW CONFIDENCE', 'RISKY',
    'NO_SAFE_BANKER', 'no_safe_banker',
    'low', 'medium', 'high', 'very_high'
  ));

-- 4. Update the football_prediction_teasers view to include simulations_count
CREATE OR REPLACE VIEW public.football_prediction_teasers AS
SELECT
    p.id,
    p.fixture_id,
    p.market,
    p.confidence_category,
    p.publication_status,
    p.secondary_predictions,
    p.simulations_count,
    p.target_kickoff_at,
    p.created_at,
    true AS is_locked
FROM public.football_predictions p
WHERE p.publication_status = 'published';

GRANT SELECT ON public.football_prediction_teasers TO anon, authenticated;
