-- =====================================================================
-- Cricket engine (phase 2): fixtures, predictions, lock and access.
-- Additive only: new tables, functions and policies with a cricket_ prefix.
-- Nothing in football, goals, tennis, basketball or the Predictions Hub
-- is touched.
--
--  * cricket_fixtures      one row per LiveScore event (scraped).
--  * cricket_predictions   one row per fixture and stage:
--                          'provisional' (day before, probable XIs) and
--                          'toss' (after the toss, announced XIs).
--  * Lock: prediction columns can never change after insert (a toss
--    update is a new row, never an edit). Only settlement columns may be
--    written. Rows starting within 48h, or settled, cannot be deleted.
--  * Access: BigBang VIP + admin only (is_multisport_entitled), the same
--    gate as tennis and basketball. Engines write with the service role.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.cricket_fixtures (
    id              text PRIMARY KEY,                 -- LiveScore Eid
    cricbuzz_id     text,
    format          text NOT NULL CHECK (format IN ('T20', 'ODI')),
    competition     text NOT NULL,
    country         text,
    home_team       text NOT NULL,
    away_team       text NOT NULL,
    start_time      timestamptz NOT NULL,
    venue           text,
    city            text,
    status          text NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled', 'live', 'finished', 'abandoned', 'postponed')),
    toss_winner     text,
    toss_decision   text CHECK (toss_decision IS NULL OR toss_decision IN ('bat', 'field')),
    result_text     text,
    winner          text,
    scores          jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cricket_fixtures_start ON public.cricket_fixtures (start_time);

CREATE TABLE IF NOT EXISTS public.cricket_predictions (
    id                      bigserial PRIMARY KEY,
    fixture_id              text NOT NULL REFERENCES public.cricket_fixtures(id) ON DELETE CASCADE,
    stage                   text NOT NULL CHECK (stage IN ('provisional', 'toss')),
    model_version           text NOT NULL,
    start_time              timestamptz NOT NULL,
    home_win_prob           numeric(5,4) NOT NULL CHECK (home_win_prob BETWEEN 0 AND 1),
    away_win_prob           numeric(5,4) NOT NULL CHECK (away_win_prob BETWEEN 0 AND 1),
    predicted_winner        text NOT NULL,
    probability             numeric(5,4) NOT NULL CHECK (probability BETWEEN 0.5 AND 1),
    tier                    text NOT NULL CHECK (tier IN ('ELITE', 'STANDARD', 'WATCH')),
    bat_first               text,
    first_innings_median    numeric(6,1),
    players_rated           jsonb NOT NULL DEFAULT '{}'::jsonb,   -- team -> rated players count
    unmatched_players       integer NOT NULL DEFAULT 0,
    odds                    jsonb NOT NULL DEFAULT '{}'::jsonb,   -- team -> decimal odds at publish
    settlement_status       text NOT NULL DEFAULT 'pending'
                            CHECK (settlement_status IN ('pending', 'won', 'lost', 'void')),
    actual_winner           text,
    settled_at              timestamptz,
    created_at              timestamptz NOT NULL DEFAULT now(),
    UNIQUE (fixture_id, stage)
);

CREATE INDEX IF NOT EXISTS idx_cricket_predictions_start ON public.cricket_predictions (start_time);
CREATE INDEX IF NOT EXISTS idx_cricket_predictions_pending ON public.cricket_predictions (settlement_status)
    WHERE settlement_status = 'pending';

-- ---------------------------------------------------------------- lock
CREATE OR REPLACE FUNCTION public.enforce_cricket_prediction_immutability()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.settlement_status <> 'pending' OR OLD.start_time <= NOW() + INTERVAL '2 days' THEN
            RAISE EXCEPTION 'cricket prediction % is locked (settled or starts within 48h)', OLD.id;
        END IF;
        RETURN OLD;
    END IF;
    -- prediction columns never change after insert
    NEW.fixture_id := OLD.fixture_id; NEW.stage := OLD.stage; NEW.model_version := OLD.model_version;
    NEW.start_time := OLD.start_time; NEW.home_win_prob := OLD.home_win_prob; NEW.away_win_prob := OLD.away_win_prob;
    NEW.predicted_winner := OLD.predicted_winner; NEW.probability := OLD.probability; NEW.tier := OLD.tier;
    NEW.bat_first := OLD.bat_first; NEW.first_innings_median := OLD.first_innings_median;
    NEW.players_rated := OLD.players_rated; NEW.unmatched_players := OLD.unmatched_players;
    NEW.odds := OLD.odds; NEW.created_at := OLD.created_at;
    -- a settled result cannot be reopened
    IF OLD.settlement_status IN ('won', 'lost', 'void') THEN
        NEW.settlement_status := OLD.settlement_status;
        NEW.actual_winner := OLD.actual_winner;
        NEW.settled_at := OLD.settled_at;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_enforce_cricket_prediction_immutability ON public.cricket_predictions;
CREATE TRIGGER trg_enforce_cricket_prediction_immutability
    BEFORE UPDATE OR DELETE ON public.cricket_predictions
    FOR EACH ROW EXECUTE FUNCTION public.enforce_cricket_prediction_immutability();

-- ---------------------------------------------------------------- access
ALTER TABLE public.cricket_fixtures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cricket_predictions ENABLE ROW LEVEL SECURITY;

-- Fixtures (teams, times, scores) are public like any score site.
DROP POLICY IF EXISTS "cricket_fixtures_public_read" ON public.cricket_fixtures;
CREATE POLICY "cricket_fixtures_public_read" ON public.cricket_fixtures
    FOR SELECT USING (true);

-- Predictions: BigBang VIP + admin only (same gate as tennis/basketball).
DROP POLICY IF EXISTS "cricket_predictions_vip_read" ON public.cricket_predictions;
CREATE POLICY "cricket_predictions_vip_read" ON public.cricket_predictions
    FOR SELECT USING (public.is_multisport_entitled());

REVOKE INSERT, UPDATE, DELETE ON public.cricket_fixtures FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.cricket_predictions FROM anon, authenticated;
GRANT SELECT ON public.cricket_fixtures TO anon, authenticated;
GRANT SELECT ON public.cricket_predictions TO authenticated;
GRANT ALL ON public.cricket_fixtures, public.cricket_predictions TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.cricket_predictions_id_seq TO service_role;

-- ROLLBACK (manual):
--   DROP TABLE public.cricket_predictions; DROP TABLE public.cricket_fixtures;
--   DROP FUNCTION public.enforce_cricket_prediction_immutability();
