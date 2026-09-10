-- JamBets — Add venue to football_fixtures
ALTER TABLE public.football_fixtures ADD COLUMN IF NOT EXISTS venue TEXT;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
