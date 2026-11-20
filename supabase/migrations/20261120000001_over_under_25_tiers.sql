-- =====================================================================
-- Over/Under 2.5 engine v2: allow the new two-sided tiers on goals_predictions.
-- Only the confidence_tier CHECK constraint changes. The market key stays
-- 'over_2.5_goals' (now meaning the Over/Under 2.5 market) and predicted_outcome
-- is 'OVER_2.5' or 'UNDER_2.5'. Old tiers stay valid so settled history is untouched.
-- No other table, view, policy or trigger is changed.
-- =====================================================================
alter table public.goals_predictions
  drop constraint if exists goals_predictions_confidence_tier_check;

alter table public.goals_predictions
  add constraint goals_predictions_confidence_tier_check
  check (confidence_tier = any (array[
    'GOAL_MACHINE', 'OVER_25_LOCK', 'EARLY_STRIKE', 'TEMPO_HIGH', 'LEAN_OVER', 'LOCKED',
    'ELITE_OVER', 'STANDARD_OVER', 'ELITE_UNDER', 'STANDARD_UNDER'
  ]::text[]));

-- ROLLBACK (only after removing any rows that use the new tiers):
--   alter table public.goals_predictions drop constraint goals_predictions_confidence_tier_check;
--   alter table public.goals_predictions add constraint goals_predictions_confidence_tier_check
--     check (confidence_tier = any (array['GOAL_MACHINE','OVER_25_LOCK','EARLY_STRIKE','TEMPO_HIGH','LEAN_OVER','LOCKED']::text[]));
