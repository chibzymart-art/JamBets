# Over/Under 2.5 engine (v2)

Code: `python/src/goals/over25_engine.py` and `python/src/goals/ou25/`.
Runs daily at 00:00 UTC (01:00 WAT) in `.github/workflows/goals_engine.yml`, predicting
fixtures up to 4 days ahead. Settlement runs in `settlement_engine.yml`.

## Why it was rebuilt (20 Nov 2026)

v1 could only tip Over and its live record was 221 won / 174 lost (56%) while showing
about 75% confidence. A replay of v1 on 22,961 matches gave the same 56%, equal to the
bookmaker price. Causes: team ratings from ~18 days of results (most teams rated from one
home game), likely double counting, no calibration, gates built on noise, Over-only schema.

## How v2 works

1. **History**: about 18 months of league results per league from football-data.co.uk
   (free CSVs, 12-hour disk cache). No Supabase rows are pulled for history.
2. **Ratings**: age-weighted (half-life 150 days) attack/defence per team, shrunk toward
   league average (6 matches), league averages computed from the data. Vectorised with numpy.
3. **Probability**: Dixon-Coles score matrix (unchanged model).
4. **Calibration**: logistic curve fitted on past matches. Where bookmaker Over/Under 2.5
   prices exist (football-data `fixtures.csv`, main European leagues), the calibrated value
   blends model and de-vigged market probability.
5. **Pick**: Over if P(Over) clears its bar, Under if P(Under) clears its bar, else no pick.
   Unders are never tipped in Serie A (backtest ~51%).

| Tier | When | Walk-forward win rate (Jul 2024 - Nov 2026) |
| --- | --- | --- |
| ELITE_OVER | with odds, P(Over) >= 78% | 89% (99 picks) |
| STANDARD_OVER | with odds, P(Over) >= 65% | 67% (1,436) |
| STANDARD_UNDER | with odds, P(Under) >= 60% | 62% (977) |
| STANDARD_OVER | no odds, P(Over) >= 64% | 72% (338) |
| STANDARD_UNDER | no odds, P(Under) >= 62% | 69% (449) |

All picks together: about 67%, 5.7 picks per day on days with picks. No Under setting
reached 80%, so `ELITE_UNDER` exists in the schema but is switched off in `ou25/model.py`.
These are backtest figures, not a guarantee; no setting wins 80% every day.

## Storage

`public.goals_predictions`, market key `over_2.5_goals` (kept so feeds, counts, the paywall
view and settlement keep working), `predicted_outcome` `OVER_2.5` or `UNDER_2.5`, tiers above
(migration `20261120000001_over_under_25_tiers.sql`). Metadata carries the raw, calibrated and
market probabilities and the odds used.

## Cost per run

About 5 Supabase requests (fixtures with embedded teams and leagues, existing picks, upsert
batches, stale-pick cleanup) and about 45 small CSV downloads (cached). v1 pulled 3,000+
fixture rows and 2,000 team rows and called FotMob, Google News and Gemini per fixture.

## Operations

- Replace pending O/U picks (for example after a model change): run the `goals_engine`
  workflow manually with `ou25_wipe_pending` ticked. Only picks more than 48 hours away are
  replaced; locked and settled picks stay.
- Lock: trigger `trg_enforce_goals_prediction_immutability` (migration
  `20261120000002_ou25_prediction_lock.sql`, O/U market only) freezes settled picks and picks
  kicking off within 48 hours. The engine also skips those fixtures.
- Refit: rerun the backtest scripts kept in the project files (`o25-investigation`) and update
  `CAL_MODEL`, `CAL_BLEND` and `THRESHOLDS` in `ou25/model.py`.
