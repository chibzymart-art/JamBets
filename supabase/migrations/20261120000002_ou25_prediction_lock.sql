-- =====================================================================
-- Over/Under 2.5: restore the 48h prediction lock on goals_predictions.
-- The trigger from 20260914000002 was never present in production.
-- Scoped to market 'over_2.5_goals' only, so the 1H market is unchanged.
-- Settled picks and picks kicking off within 48h keep their prediction
-- columns; settlement fields can still be written. Applied live 20 Nov 2026.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.enforce_goals_prediction_immutability()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.settlement_status IN ('won', 'lost', 'void') THEN
        IF NEW.settlement_status = 'pending' THEN NEW.settlement_status := OLD.settlement_status; END IF;
    ELSIF NOT (OLD.target_kickoff_at IS NOT NULL AND OLD.target_kickoff_at <= NOW() + INTERVAL '2 days') THEN
        RETURN NEW;
    END IF;
    NEW.fixture_id := OLD.fixture_id; NEW.market := OLD.market; NEW.predicted_outcome := OLD.predicted_outcome;
    NEW.probability := OLD.probability; NEW.confidence_tier := OLD.confidence_tier; NEW.xg_combined := OLD.xg_combined;
    NEW.home_over25_rate := OLD.home_over25_rate; NEW.away_over25_rate := OLD.away_over25_rate; NEW.h2h_over25_rate := OLD.h2h_over25_rate;
    NEW.ht_goal_frequency := OLD.ht_goal_frequency; NEW.avg_first_goal_minute := OLD.avg_first_goal_minute; NEW.target_kickoff_at := OLD.target_kickoff_at;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_enforce_goals_prediction_immutability ON public.goals_predictions;
CREATE TRIGGER trg_enforce_goals_prediction_immutability
    BEFORE UPDATE ON public.goals_predictions
    FOR EACH ROW WHEN (OLD.market = 'over_2.5_goals')
    EXECUTE FUNCTION public.enforce_goals_prediction_immutability();

-- ROLLBACK: DROP TRIGGER trg_enforce_goals_prediction_immutability ON public.goals_predictions;
