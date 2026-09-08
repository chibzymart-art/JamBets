-- JamBets Phase 2: Public Read Policies for Football Data Consumption
-- Allows frontend and client applications to consume verified leagues, teams, fixtures, and sources via anon key.

ALTER TABLE public.football_leagues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read football_leagues" ON public.football_leagues;
CREATE POLICY "Public read football_leagues"
  ON public.football_leagues
  FOR SELECT
  TO anon, authenticated
  USING (true);

ALTER TABLE public.football_teams ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read football_teams" ON public.football_teams;
CREATE POLICY "Public read football_teams"
  ON public.football_teams
  FOR SELECT
  TO anon, authenticated
  USING (true);

ALTER TABLE public.football_fixtures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read football_fixtures" ON public.football_fixtures;
CREATE POLICY "Public read football_fixtures"
  ON public.football_fixtures
  FOR SELECT
  TO anon, authenticated
  USING (true);

ALTER TABLE public.football_fixture_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read football_fixture_sources" ON public.football_fixture_sources;
CREATE POLICY "Public read football_fixture_sources"
  ON public.football_fixture_sources
  FOR SELECT
  TO anon, authenticated
  USING (true);
