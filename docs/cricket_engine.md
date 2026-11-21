# Cricket engine

Status: phase 1 (data, model, back-test). Nothing writes to Supabase and no
site code changes yet. Plan: https://claude.ai/artifact/278zpAiDsLrruFDhar1LJP

## Sources (all scraped or free, no paid feed)

| Need | Source | Module |
| --- | --- | --- |
| Fixtures, live scores, toss, XIs, venue, result | LiveScore public app API | `python/src/cricket/scrapers/livescore.py` |
| Cross-check, toss, venue lat/long (weather), live decimal odds | Cricbuzz match-centre JSON | `python/src/cricket/scrapers/cricbuzz.py` |
| Ball-by-ball history (training) | Cricsheet.org archives (ODC-BY, credit required) | `python/src/cricket/history.py` |
| Player identity | Cricsheet register (`key_bigbash` = LiveScore player ID, `key_cricbuzz` = Cricbuzz ID) | `python/src/cricket/identity.py` |

LiveScore toss codes: `TPa` = team number that won the toss (0 = not yet),
`TCho` 1 = bat, 2 = field. XIs appear at the toss.

Scrapers raise on HTTP errors or a changed payload, never return an empty
list silently.

## Model

1. **Context baseline** per format x phase (powerplay, middle, death) x
   wickets lost, learned from history with a 2-year half-life.
2. **Competition and venue factors** (1-year half-life) for scoring level,
   e.g. the IPL since the Impact Player rule.
3. **Chase behaviour**: second-innings outcome shift by required run rate.
4. **Player skills**: batter and bowler multipliers per phase and outcome,
   opponent-adjusted and shrunk to average (no default ratings).
5. **Team Elo** per format with margin of victory.
6. **Monte Carlo**: ball-by-ball, real XI, usual batting order and bowling
   shares from past matches, bowling quotas, chasing logic.
7. **Calibration blend**: logistic regression on simulator, same-format Elo
   and other-format Elo, refitted monthly on earlier predictions only.
8. **Screening**: Elite needs the favourite's probability above a cut-off and
   enough rated players and team history; the cut-off is chosen on the
   selection period and scored on an untouched test period.

## Running the back-test

```
python -c "from python.src.cricket.history import *; save_cache(load_archives(download_archives('cricket_data')), 'cricket_data/history.json.gz')"
python -m python.src.cricket.backtest simulate --cache cricket_data/history.json.gz --out preds_0.jsonl --shard 0 --shards 4   # x4 in parallel
python -m python.src.cricket.backtest analyse --preds preds_0.jsonl,preds_1.jsonl,preds_2.jsonl,preds_3.jsonl --report report.md
```

Or run the manual workflow **Cricket Engine Back-test** in GitHub Actions; the
report shows in the run summary.

## Leakage rules

- Predictions use only matches before the one predicted; the model learns
  from a match only after predicting it.
- Toss-time predictions may use the announced XI and toss; batting order and
  bowling plans come from past matches, never the match itself.
- Tier cut-offs are chosen on data before the test period.

Data: Cricsheet.org

## Live engine (phase 2)

- `python -m python.src.cricket.run_engine predict` (hourly workflow
  `cricket_engine.yml`): scrapes LiveScore for yesterday to +2 days, publishes a
  `provisional` prediction (probable XIs, both batting orders averaged) and,
  once toss and XIs are out, a `toss` prediction. Only unstarted matches are
  predicted. Rows are inserted with ignore-duplicates; the database trigger
  makes published prediction columns immutable.
- `python -m python.src.cricket.run_engine settle`: marks won / lost / void
  from LiveScore results 3+ hours after the start.
- Tables: `cricket_fixtures` (public read), `cricket_predictions` (BigBang VIP
  + admin via `is_multisport_entitled()`), migration
  `20261121000010_cricket_engine.sql`.
- Feed: `api/cricket-feed.ts` (redacts probabilities for non-VIP users).
- UI: `web/src/components/CricketHubView.tsx` at `/dashboard/cricket`.
- Tiers: ELITE is disabled (`ELITE_ENABLED = False`) until the back-test passes
  90% on 200+ picks in both periods; STANDARD = 65%+ with 9+ rated players per
  side and every player matched; otherwise WATCH.
