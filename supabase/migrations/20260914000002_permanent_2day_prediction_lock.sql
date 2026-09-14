-- =====================================================================
-- Addsbanta — Phase 11: Permanent 2-Day Prediction Immutability & Lock
-- Guarantees that predictions for Current Day & Next Day (and settled predictions)
-- can NEVER be overwritten, recalculated, or reset to pending by any engine.
-- =====================================================================

-- 1. Trigger function for goals_predictions immutability
CREATE OR REPLACE FUNCTION public.enforce_goals_prediction_immutability()
RETURNS TRIGGER AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_lock_window TIMESTAMPTZ := NOW() + INTERVAL '2 days';
    v_is_locked BOOLEAN := false;
BEGIN
    -- Condition A: Row is already settled (won, lost, void)
    IF OLD.settlement_status IN ('won', 'lost', 'void') THEN
        -- Strictly forbid resetting settlement back to pending
        IF NEW.settlement_status = 'pending' THEN
            NEW.settlement_status := OLD.settlement_status;
        END IF;
        -- Freeze all core prediction attributes permanently
        NEW.fixture_id := OLD.fixture_id;
        NEW.market := OLD.market;
        NEW.predicted_outcome := OLD.predicted_outcome;
        NEW.probability := OLD.probability;
        NEW.confidence_tier := OLD.confidence_tier;
        NEW.xg_combined := OLD.xg_combined;
        NEW.home_over25_rate := OLD.home_over25_rate;
        NEW.away_over25_rate := OLD.away_over25_rate;
        NEW.h2h_over25_rate := OLD.h2h_over25_rate;
        NEW.ht_goal_frequency := OLD.ht_goal_frequency;
        NEW.avg_first_goal_minute := OLD.avg_first_goal_minute;
        NEW.target_kickoff_at := OLD.target_kickoff_at;
        RETURN NEW;
    END IF;

    -- Condition B: Prediction kickoff falls within the Current Day & Next Day 48h Lock Window
    IF OLD.target_kickoff_at IS NOT NULL AND OLD.target_kickoff_at <= v_lock_window THEN
        v_is_locked := true;
    END IF;

    -- When locked, core prediction values become strictly immutable
    -- Only settlement engine can update settlement fields (settlement_status, actual_score, ht_score, settled_at, settlement_notes)
    IF v_is_locked THEN
        NEW.fixture_id := OLD.fixture_id;
        NEW.market := OLD.market;
        NEW.predicted_outcome := OLD.predicted_outcome;
        NEW.probability := OLD.probability;
        NEW.confidence_tier := OLD.confidence_tier;
        NEW.xg_combined := OLD.xg_combined;
        NEW.home_over25_rate := OLD.home_over25_rate;
        NEW.away_over25_rate := OLD.away_over25_rate;
        NEW.h2h_over25_rate := OLD.h2h_over25_rate;
        NEW.ht_goal_frequency := OLD.ht_goal_frequency;
        NEW.avg_first_goal_minute := OLD.avg_first_goal_minute;
        NEW.target_kickoff_at := OLD.target_kickoff_at;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Attach Trigger to public.goals_predictions
DROP TRIGGER IF EXISTS trg_enforce_goals_prediction_immutability ON public.goals_predictions;
CREATE TRIGGER trg_enforce_goals_prediction_immutability
    BEFORE UPDATE ON public.goals_predictions
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_goals_prediction_immutability();

-- 3. Also reinforce the 2-day lock on core public.football_predictions
CREATE OR REPLACE FUNCTION public.enforce_football_prediction_2day_lock()
RETURNS TRIGGER AS $$
DECLARE
    v_lock_window TIMESTAMPTZ := NOW() + INTERVAL '2 days';
BEGIN
    -- If row is already settled, protect settlement status
    IF OLD.settlement_status IN ('won', 'lost', 'void') AND NEW.settlement_status = 'pending' THEN
        NEW.settlement_status := OLD.settlement_status;
    END IF;

    -- If published OR within 2-day lock window, freeze prediction columns
    IF OLD.publication_status = 'published' OR (OLD.target_kickoff_at IS NOT NULL AND OLD.target_kickoff_at <= v_lock_window) THEN
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

DROP TRIGGER IF EXISTS trg_protect_prediction_immutability ON public.football_predictions;
CREATE TRIGGER trg_protect_prediction_immutability
    BEFORE UPDATE ON public.football_predictions
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_football_prediction_2day_lock();
