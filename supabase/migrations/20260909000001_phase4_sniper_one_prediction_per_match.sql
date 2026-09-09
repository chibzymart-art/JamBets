-- JamBets Phase 4: Sniper Mode — Exactly One Prediction Row Per Fixture
-- Adds secondary_predictions JSONB column, consolidates duplicate rows, and enforces UNIQUE (fixture_id).

-- 1. Add secondary_predictions column
ALTER TABLE public.football_predictions
  ADD COLUMN IF NOT EXISTS secondary_predictions JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 2. Consolidate any existing duplicate predictions per fixture
DO $$
DECLARE
    r RECORD;
    primary_row RECORD;
    secondary_json JSONB;
BEGIN
    FOR r IN (SELECT DISTINCT fixture_id FROM public.football_predictions) LOOP
        -- Get the highest probability prediction for this fixture
        SELECT * INTO primary_row
        FROM public.football_predictions
        WHERE fixture_id = r.fixture_id
        ORDER BY probability DESC, created_at ASC
        LIMIT 1;

        -- Get 2nd, 3rd, 4th highest probability predictions
        SELECT jsonb_agg(
            jsonb_build_object(
                'market', market,
                'prediction', prediction,
                'probability', probability,
                'prob', ROUND(probability * 100, 2),
                'confidence_tier', confidence_category
            )
        ) INTO secondary_json
        FROM (
            SELECT market, prediction, probability, confidence_category
            FROM public.football_predictions
            WHERE fixture_id = r.fixture_id AND id != primary_row.id
            ORDER BY probability DESC
            LIMIT 3
        ) sub;

        IF secondary_json IS NULL THEN
            secondary_json := '[]'::jsonb;
        END IF;

        -- Update the primary row with secondary_predictions
        UPDATE public.football_predictions
        SET secondary_predictions = secondary_json
        WHERE id = primary_row.id;

        -- Delete the non-primary rows for this fixture
        DELETE FROM public.football_predictions
        WHERE fixture_id = r.fixture_id AND id != primary_row.id;
    END LOOP;
END $$;

-- 3. Add UNIQUE constraint on fixture_id to enforce 1 Fixture = 1 Prediction Row
ALTER TABLE public.football_predictions
  DROP CONSTRAINT IF EXISTS football_predictions_fixture_id_unique;

ALTER TABLE public.football_predictions
  ADD CONSTRAINT football_predictions_fixture_id_unique UNIQUE (fixture_id);

-- 4. Broaden market check constraint to support all simulated markets
ALTER TABLE public.football_predictions
  DROP CONSTRAINT IF EXISTS football_predictions_market_check;

ALTER TABLE public.football_predictions
  ADD CONSTRAINT football_predictions_market_check
  CHECK (market IN (
    '1x2', 'double_chance', 'btts', 'correct_score',
    'over_under_0.5', 'over_under_1.5', 'over_under_2.5', 'over_under_3.5', 'over_under_4.5',
    'ht_result', 'ht_goals_0.5', 'ht_goals_1.5', '2h_goals_0.5', '2h_goals_1.5',
    'corners', 'both_teams_to_score'
  ));

-- 5. Update the football_prediction_teasers view to include secondary_predictions
CREATE OR REPLACE VIEW public.football_prediction_teasers AS
SELECT
    p.id,
    p.fixture_id,
    p.market,
    p.confidence_category,
    p.publication_status,
    p.secondary_predictions,
    p.target_kickoff_at,
    p.created_at,
    true AS is_locked
FROM public.football_predictions p
WHERE p.publication_status = 'published';

GRANT SELECT ON public.football_prediction_teasers TO anon, authenticated;
