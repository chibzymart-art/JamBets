-- PERMANENT. Removes the retired 1X2 specialist markets (home_win, away_win, draw) and their data.
-- Run by hand in the SQL editor only after exporting anything you want to keep.
-- As of 22 Oct 2026: 733 home_win, 559 away_win, 1,027 draw predictions; 118 + 0 + 9 settlements;
-- newest kickoff 29 Sept 2026. Nothing on the site, the Edge API or the engines reads them.

begin;

drop view if exists public.home_win_predictions_paywall;
drop view if exists public.away_win_predictions_paywall;
drop view if exists public.draw_predictions_paywall;

drop table if exists public.home_win_settlements;
drop table if exists public.away_win_settlements;
drop table if exists public.draw_settlements;

drop table if exists public.home_win_predictions;
drop table if exists public.away_win_predictions;
drop table if exists public.draw_predictions;

commit;
