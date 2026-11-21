-- =====================================================================
-- Main football: restore the 48h prediction lock on football_predictions.
-- The trigger from 20260914000002 was never present in production.
-- Settled picks and picks kicking off within 48h keep their prediction
-- columns; settlement fields can still be written. Applied live 21 Nov 2026.
-- Unlike 20260914000002, published picks more than 48h away are NOT frozen,
-- matching the engine's own 48h rule.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.enforce_football_prediction_2day_lock()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.settlement_status IN ('won', 'lost', 'void') THEN
        IF NEW.settlement_status = 'pending' THEN NEW.settlement_status := OLD.settlement_status; END IF;
    ELSIF NOT (OLD.target_kickoff_at IS NOT NULL AND OLD.target_kickoff_at <= NOW() + INTERVAL '2 days') THEN
        RETURN NEW;
    END IF;
    NEW.fixture_id := OLD.fixture_id; NEW.market := OLD.market; NEW.prediction := OLD.prediction;
    NEW.probability := OLD.probability; NEW.confidence_category := OLD.confidence_category;
    NEW.secondary_predictions := OLD.secondary_predictions; NEW.target_kickoff_at := OLD.target_kickoff_at;
    NEW.tier_required := OLD.tier_required; NEW.simulations_count := OLD.simulations_count;
    NEW.source_data_version := OLD.source_data_version;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_protect_prediction_immutability ON public.football_predictions;
CREATE TRIGGER trg_protect_prediction_immutability
    BEFORE UPDATE ON public.football_predictions
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_football_prediction_2day_lock();

-- ROLLBACK: DROP TRIGGER trg_protect_prediction_immutability ON public.football_predictions;
