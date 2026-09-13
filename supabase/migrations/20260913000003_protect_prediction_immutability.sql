-- =====================================================================
-- JamBets Settlement Isolation & Prediction Immutability Migration
-- Enforces:
-- 1. Database-level trigger on football_predictions:
--    Once publication_status = 'published', freezes core prediction columns:
--    (market, prediction, probability, confidence_category, secondary_predictions, target_kickoff_at)
--    Only settlement fields (settlement_status, settled_at, actual_score, settlement_notes, metadata, updated_at)
--    can be updated by the settlement engine.
-- 2. Unique constraint on canonical_key in football_fixtures to prevent duplicate fixture creation.
-- =====================================================================

-- 1. Trigger function to protect published prediction immutability
CREATE OR REPLACE FUNCTION public.protect_published_prediction_immutability()
RETURNS TRIGGER AS $$
BEGIN
  -- If row is already published, core prediction fields become strictly immutable
  IF OLD.publication_status = 'published' THEN
    NEW.fixture_id := OLD.fixture_id;
    NEW.market := OLD.market;
    NEW.prediction := OLD.prediction;
    NEW.probability := OLD.probability;
    NEW.confidence_category := OLD.confidence_category;
    NEW.secondary_predictions := OLD.secondary_predictions;
    NEW.target_kickoff_at := OLD.target_kickoff_at;
    NEW.tier_required := OLD.tier_required;
    NEW.simulations_count := OLD.simulations_count;
    NEW.source_data_version := OLD.source_data_version;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Attach trigger to football_predictions table
DROP TRIGGER IF EXISTS trg_protect_prediction_immutability ON public.football_predictions;
CREATE TRIGGER trg_protect_prediction_immutability
BEFORE UPDATE ON public.football_predictions
FOR EACH ROW
EXECUTE FUNCTION public.protect_published_prediction_immutability();

-- 3. Enforce Unique constraint on canonical_key in football_fixtures
ALTER TABLE public.football_fixtures
  DROP CONSTRAINT IF EXISTS football_fixtures_canonical_key_unique;

ALTER TABLE public.football_fixtures
  ADD CONSTRAINT football_fixtures_canonical_key_unique UNIQUE (canonical_key);
