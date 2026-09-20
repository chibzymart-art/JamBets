-- Migration: 20260920000002_drop_unused_legacy_tables.sql
-- Description: Drop 10 dead legacy tables identified during the database audit.
-- Verification: All 10 tables have 0 rows and 0 active references in the codebase.

DROP TABLE IF EXISTS public.api_usage_logs CASCADE;
DROP TABLE IF EXISTS public.automation_cycles CASCADE;
DROP TABLE IF EXISTS public.bankroll_logs CASCADE;
DROP TABLE IF EXISTS public.football_market_odds CASCADE;
DROP TABLE IF EXISTS public.football_prediction_markets CASCADE;
DROP TABLE IF EXISTS public.football_result_sources CASCADE;
DROP TABLE IF EXISTS public.football_simulation_results CASCADE;
DROP TABLE IF EXISTS public.simulation_engine_status CASCADE;
DROP TABLE IF EXISTS public.user_preferences CASCADE;
DROP TABLE IF EXISTS public.value_bets CASCADE;
