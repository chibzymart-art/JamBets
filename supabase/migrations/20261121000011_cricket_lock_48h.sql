-- Cricket: 48-hour lock (owner, 21 Nov 2026).
-- A prediction may be refreshed while its match is more than 48 hours away.
-- From 48 hours before the start (today and tomorrow), and once settled, its
-- prediction columns can never change again. Settled results still can't be
-- reopened, and locked or settled rows still can't be deleted.
-- Only this trigger function changes; tables, policies and grants are untouched.

CREATE OR REPLACE FUNCTION public.enforce_cricket_prediction_immutability()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.settlement_status <> 'pending' OR OLD.start_time <= NOW() + INTERVAL '48 hours' THEN
            RAISE EXCEPTION 'cricket prediction % is locked (settled or starts within 48h)', OLD.id;
        END IF;
        RETURN OLD;
    END IF;

    -- identity of the row never changes
    NEW.fixture_id := OLD.fixture_id;
    NEW.stage := OLD.stage;
    NEW.created_at := OLD.created_at;

    -- locked: within 48h of the start (by the stored start time) or settled
    IF OLD.start_time <= NOW() + INTERVAL '48 hours' OR OLD.settlement_status <> 'pending' THEN
        NEW.model_version := OLD.model_version;
        NEW.start_time := OLD.start_time;
        NEW.home_win_prob := OLD.home_win_prob;
        NEW.away_win_prob := OLD.away_win_prob;
        NEW.predicted_winner := OLD.predicted_winner;
        NEW.probability := OLD.probability;
        NEW.tier := OLD.tier;
        NEW.bat_first := OLD.bat_first;
        NEW.first_innings_median := OLD.first_innings_median;
        NEW.players_rated := OLD.players_rated;
        NEW.unmatched_players := OLD.unmatched_players;
        NEW.odds := OLD.odds;
    END IF;

    -- a settled result cannot be reopened
    IF OLD.settlement_status IN ('won', 'lost', 'void') THEN
        NEW.settlement_status := OLD.settlement_status;
        NEW.actual_winner := OLD.actual_winner;
        NEW.settled_at := OLD.settled_at;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;

-- Trigger-only function: nobody needs to call it directly (Security Advisor).
REVOKE EXECUTE ON FUNCTION public.enforce_cricket_prediction_immutability() FROM PUBLIC, anon, authenticated;

-- Rollback (back to "frozen at insert"): re-run the function body from
-- 20261121000010_cricket_engine.sql.
