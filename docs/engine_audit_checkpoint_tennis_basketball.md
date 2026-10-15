# Forensic Investigation Checkpoint: Tennis & Basketball Prediction Engines

**Date & Time:** October 13, 2026  
**Target Platforms:** 
- Live Web Application: [Oddsbanta Dashboard](https://www.oddsbanta.com)
- Database: Supabase Production Instance (`vepcoopomlfjageijsew.supabase.co`)
- Prediction Repositories: [`python/src/tennis/`](file:///c:/Users/HP/Documents/JamBets/python/src/tennis/) & [`python/src/basketball/`](file:///c:/Users/HP/Documents/JamBets/python/src/basketball/)

---

## 1. Executive Summary & Production Telemetry

A forensic analysis was performed directly against the production database, the live frontend UI via browser inspection, and the mathematical simulation codebase.

### Key Performance Metrics
| Sport | Live UI Settled Record | Database Settled Record | Core Diagnostic Conclusion |
| :--- | :--- | :--- | :--- |
| **Tennis** | **16W – 10L (62%)**<br>• ⭐ Banger: 0W – 1L (0%)<br>• 👑 Top Pick: 1W – 2L (33%)<br>• ⚡ High Conf: 6W – 3L (67%) | **50.0% Win Rate** on Match Winners.<br>**60.4% Void Rate** (604/1000 rows labeled `NO_SAFE_BANKER`). | **67.6% of all players in `tennis_players` have NULL rank and default 1450 ELO**. The engine simulates phantom match advantages based on missing player data. |
| **Basketball** | **42W – 25L (63%)**<br>• Totals: 50.0% (Coin Toss)<br>• Spreads: 53.8% (Coin Toss)<br>• Moneylines: 83.3% at 1.09 avg odds | **56.0% Overall Win Rate** on Spreads/Totals.<br>Moneylines: 170W – 34L (83.3%) at 1.09 avg odds (**-9.2% Net ROI**). | **99.8% of fixtures lack sportsbook lines/odds**. The engine invents a static fallback line of `162.0` for all non-NBA totals, causing a 50/50 guessing coin flip. |

---

## 2. Tennis Engine: Root Cause Analysis

### Flaw 1: 67.6% Missing Player Data & Entity Duplication
- **Total Players in Database:** 973
- **Players with `current_rank: null`:** **658 (67.6%)**
- **Players with flat `1450.0` ELO:** **658 (67.6%)**
- **Entity Resolution Glitch:** The database contains duplicate entries with slight name variations (e.g., `alexander_shevchenko` with `rank=null, elo=1450` vs `aleksandr_shevchenko` with `rank=111, elo=1608.5`).
- **Production Impact:** When Miomir Kecmanovic (ELO 1761.5) faced Alexander Shevchenko, the engine paired him against the 1450 phantom record. The resulting false +311.5 ELO gap made Kecmanovic an artificial 77.1% banker. Shevchenko won in straight sets (`6-3, 6-4`).

### Flaw 2: Zero Individual Player Serve/Return Statistics
- In [`python/src/tennis/prediction_engine.py`](file:///c:/Users/HP/Documents/JamBets/python/src/tennis/prediction_engine.py#L79-L95), single point serve probabilities are computed solely from:
  $$\Delta_{\text{serve}} = \tanh\left(\frac{\text{elo\_diff}}{480.0}\right) \times 0.052$$
- The 250,000 Monte Carlo simulator does not ingest actual 1st Serve %, 2nd Serve Won %, Return Points Won %, Break Points Saved %, or Break Points Converted %.
- Players with disparate playing styles (e.g. big servers vs baseline counterpunchers) are treated identically if their ELOs are similar.

### Flaw 3: Hardcoded Surface Affinity List (12 Players Only)
- In [`python/src/tennis/elo_engine.py`](file:///c:/Users/HP/Documents/JamBets/python/src/tennis/elo_engine.py#L19-L35), surface adjustments are hardcoded to a static set of 12 names.
- For the other **961 players in the database**, `hard_elo`, `clay_elo`, `grass_elo`, and `indoor_elo` are completely identical. There is no dynamic rolling calculation from past match results.

### Flaw 4: Quarantine Collapse (60.4% NO_SAFE_BANKER)
- Because unranked players default to 1450 ELO, matchups between two unranked or lower-tier players produce an ELO delta of 0.
- This immediately triggers the `NO_SAFE_BANKER` quarantine, voiding 604 out of 1,000 matches.

### Flaw 5: Inverted Tier Calibration
- Live inspection demonstrated that ⭐ **Banger (96%+ confidence)** and 👑 **Top Pick (90%–95%)** had the lowest win rates (0% and 33%), while lower tiers performed better. Extreme ELO gaps often reflect database errors or late-stage fatigue/injury rather than true banker reliability.

---

## 3. Basketball Engine: Root Cause Analysis

### Flaw 1: 99.8% Missing Odds and Betting Lines
- Sample of 500 fixtures in `basketball_fixtures`:
  - `market_spread` is NULL: **499 (99.8%)**
  - `market_total` is NULL: **499 (99.8%)**
  - `moneyline_odds` is NULL: **500 (100.0%)**
- The engine operates without consensus sportsbook benchmarks.

### Flaw 2: The Hardcoded "162.0" Game Total Fallback
- In [`python/src/basketball/prediction_engine.py`](file:///c:/Users/HP/Documents/JamBets/python/src/basketball/prediction_engine.py#L186-L203):
  When `market_total` is NULL, all non-NBA games fall back to an arbitrary baseline of `162.0`.
- The engine predicts "Over 162.0" or "Under 162.0" regardless of the true market line (e.g. 142.5 in half-court European leagues or 176.5 in fast leagues).
- **Result:** Top Pick Game Totals have settled at **9 Won and 9 Lost (50.0% Win Rate — Pure Coin Toss)**.

### Flaw 3: Synthetic Point Spreads
- Lacking real handicap lines, the engine constructs synthetic spreads centered on where its simulation sits at ~65% probability.
- High Confidence point spreads have a **53.8% win rate** (7 won, 6 lost), offering no edge over a random guess.

### Flaw 4: Negative ROI on Moneyline "Bangers" (-9.2% ROI)
- In the absence of real odds, candidates are ranked purely by `probability * 50.0`.
- This always selects lopsided Moneyline favorites:
  - Average fair odds: **1.09** (average probability: 92.7%).
  - Settled record: 170 won, 34 lost (83.3%).
  - **ROI Calculation:** On 204 bets of $100 ($20,400 staked), 170 wins at 1.09 return $18,530. Net loss = **-$1,870 (-9.17% ROI)**.
- A single upset eliminates the profit of 11 to 25 consecutive wins.

### Flaw 5: Static Seasonal Four Factors
- Team efficiencies in `basketball_teams` are static season averages.
- The engine fails to account for player resting (load management), injuries, or rotation changes, which can swing team net ratings by 10–18 points per 100 possessions.

---

## 4. Complete Action Plan & Remedies

### Phase 1: Tennis Data Reconciliation & Serve/Return Ingestion
1. **Player Database Entity Cleanup:** Deduplicate canonical player names and sync live ATP/WTA rankings and entry points for all unranked players.
2. **Dual-Parameter Markov Modeling:** Ingest actual 1st Serve %, 2nd Serve Won %, and Return Points Won % into [`simulation.py`](file:///c:/Users/HP/Documents/JamBets/python/src/tennis/simulation.py) instead of deriving serve advantage from ELO delta.
3. **Dynamic 24-Month Rolling Surface ELO:** Calculate surface-specific ratings dynamically from historical match results rather than relying on a hardcoded 12-player list.
4. **Recalibrate Confidence Categories:** Ground "Banger" classifications in form, surface history, and head-to-head records rather than raw ELO spreads.

### Phase 2: Basketball Odds Anchoring & Market Selection Reform
1. **Sportsbook Odds Ingestion:** Bridge the odds ingestor to populate `market_spread`, `market_total`, and moneyline odds from consensus bookmaker feeds.
2. **Strict Invariant Guardrail:** If `market_total` is NULL, **refuse to predict Over/Under**. Never evaluate against the hardcoded `162.0` fallback.
3. **Value-Weighted Market Selection:** Disallow moneyline picks with odds below 1.35 from receiving the "Banger" label. Rank candidates by **Expected Value Edge (+EV)**:
   $$\text{Edge \%} = \text{Probability} - \frac{1}{\text{Bookmaker Odds}}$$
4. **Recent Form Weighting:** Weight team Four Factors with 70% emphasis on the last 10 games and 30% on full-season metrics.

---

## 5. Status
- **Investigation Complete:** All findings grounded in live UI observation and production database queries.
- **Code State:** Zero code modifications or deployments executed during this investigation.
