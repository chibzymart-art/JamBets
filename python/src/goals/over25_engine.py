"""
JamBets — Over/Under 2.5 Goals Engine (v2, two-sided)

Predicts OVER_2.5 or UNDER_2.5 for upcoming league fixtures, in two tiers
(ELITE / STANDARD), stored in public.goals_predictions under the existing
market key 'over_2.5_goals' (kept so feeds, counts and settlement keep working).

Why v2 (measured 20 Nov 2026): v1 rated teams from ~18 days of results, never
calibrated its probability and could only say Over; its live record was 221 won /
174 lost (56%) while it showed ~75% confidence. v2:
  * rates teams from ~18 months of league results (age-weighted, shrunk),
  * calibrates the Dixon-Coles probability on 22,961 past matches,
  * blends in bookmaker Over/Under 2.5 prices where available (free CSV feed),
  * tips whichever side clears its own backtested bar, or nothing.

Data cost per run: ~4-8 small Supabase requests (was 3,000+ rows plus per-fixture
FotMob, Google News and Gemini calls). History comes from football-data.co.uk with a
12-hour disk cache. See python/src/goals/ou25/.
"""

import math
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..')))
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from python.src.db.supabase_client import CloudSupabaseClient
from python.src.goals.ou25 import model as ou_model
from python.src.goals.ou25.matcher import best_match
from python.src.goals.ou25.sources import LEAGUE_SOURCES, devig, load_histories, load_upcoming_odds

MARKET = "over_2.5_goals"          # storage key for the Over/Under 2.5 market (unchanged)
MODEL_VERSION = "ou25-v2"
HORIZON_DAYS = 4
LOCK_HOURS = 48                    # same 48h immutability window as the DB trigger


def _ts(d: datetime) -> str:
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def clean_league_name(name: str) -> str:
    if not name:
        return "Football League"
    fixes = {
        "Brasileiro Srie A": "Brasileirão Série A",
        "Liga Profesional de Ftbol": "Liga Profesional de Fútbol",
        "Sper Lig": "Süper Lig",
    }
    for bad, good in fixes.items():
        name = name.replace(bad, good)
    return name


def _slug_or_name(fx: Dict[str, Any], side: str, idx: int) -> Tuple[str, str]:
    """(matching key, display name) for one side of a fixture. Team `name` is the slug."""
    team = fx.get(f"{side}_team") or {}
    parts = (fx.get("canonical_key") or "").split(":")
    slug = team.get("name") or (parts[idx] if len(parts) > idx else "")
    display = team.get("short_name") or slug.replace("-", " ").title()
    return slug.replace("-", " "), display


def _team_form(hist, team: str, last_n: int = 10) -> Optional[int]:
    """Over 2.5 % in a team's last N league matches (for the card's form stats)."""
    idx = [i for i in range(len(hist.home) - 1, -1, -1) if hist.home[i] == team or hist.away[i] == team][:last_n]
    if not idx:
        return None
    overs = sum(1 for i in idx if hist.hg[i] + hist.ag[i] >= 3)
    return int(round(100.0 * overs / len(idx)))


def _h2h_rate(hist, a: str, b: str) -> Optional[int]:
    idx = [i for i in range(len(hist.home)) if {hist.home[i], hist.away[i]} == {a, b}]
    if len(idx) < 2:
        return None
    return int(round(100.0 * sum(1 for i in idx if hist.hg[i] + hist.ag[i] >= 3) / len(idx)))


def _rationale(side: str, lam_h: float, lam_a: float, p_side: float, p_market: Optional[float],
               home: str, away: str) -> Tuple[str, str]:
    total = lam_h + lam_a
    tempo = "HIGH_TEMPO" if total >= 3.0 else ("DEFENSIVE_LOW_BLOCK" if total <= 2.3 else "BALANCED")
    line = f"Model projects {home} {lam_h:.2f} - {lam_a:.2f} {away} ({total:.2f} goals in total)."
    if p_market is not None:
        mkt = p_market if side == "OVER_2.5" else 1.0 - p_market
        line += f" Bookmakers price {'Over' if side == 'OVER_2.5' else 'Under'} 2.5 at {mkt * 100:.0f}%;"
    line += f" calibrated chance of {'3+ goals' if side == 'OVER_2.5' else '2 goals or fewer'}: {p_side * 100:.0f}%."
    return line, tempo


class Over25GoalsEngine:
    """Two-sided Over/Under 2.5 engine (class name kept for run_goals_cycle)."""

    def __init__(self, db: Optional[CloudSupabaseClient] = None):
        self.db = db or CloudSupabaseClient()

    # ------------------------------------------------------------------ data
    def _fixtures(self, now: datetime) -> List[Dict[str, Any]]:
        codes = ",".join(sorted(LEAGUE_SOURCES))
        select = (
            "id,target_kickoff_at,canonical_key,status,"
            "league:football_leagues!inner(code,name),"
            "home_team:football_teams!football_fixtures_home_team_id_fkey(name,short_name),"
            "away_team:football_teams!football_fixtures_away_team_id_fkey(name,short_name)"
        )
        params = {
            "select": select,
            "status": "in.(scheduled,live,in_progress,halftime)",
            "target_kickoff_at": f"gte.{_ts(now - timedelta(minutes=5))}",
            "and": f"(target_kickoff_at.lte.{_ts(now + timedelta(days=HORIZON_DAYS))})",
            "league.code": f"in.({codes})",
            "order": "target_kickoff_at.asc",
            "limit": "1000",
        }
        try:
            return self.db.get("football_fixtures", params) or []
        except Exception as e:  # filter on the embedded league not accepted: filter here instead
            print(f"⚠️ [OU25] Embedded league filter failed ({e}); filtering locally.")
            params.pop("league.code")
            rows = self.db.get("football_fixtures", params) or []
            return [r for r in rows if (r.get("league") or {}).get("code") in LEAGUE_SOURCES]

    def _existing(self, fixture_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        out: Dict[str, Dict[str, Any]] = {}
        for i in range(0, len(fixture_ids), 100):
            chunk = fixture_ids[i:i + 100]
            rows = self.db.get("goals_predictions", {
                "select": "id,fixture_id,settlement_status,target_kickoff_at,predicted_outcome",
                "market": f"eq.{MARKET}",
                "fixture_id": f"in.({','.join(chunk)})",
            }) or []
            for r in rows:
                out[r["fixture_id"]] = r
        return out

    # ------------------------------------------------------------------- run
    def run(self, max_fixtures: int = 1000, wipe_pending: bool = False) -> Dict[str, Any]:
        print("⚽ [OU25] Launching Over/Under 2.5 engine v2 (two-sided, calibrated)...")
        now = datetime.now(timezone.utc)
        now_iso = now.isoformat()
        lock_until = now + timedelta(hours=LOCK_HOURS)

        if wipe_pending:
            # Only picks beyond the 48h lock are replaced; locked and settled picks are never touched.
            print("🧹 [OU25] Wiping pending Over/Under 2.5 predictions beyond the 48h lock...")
            self.db.delete("goals_predictions", {"market": f"eq.{MARKET}", "settlement_status": "eq.pending",
                                                 "target_kickoff_at": f"gt.{_ts(lock_until)}"})

        fixtures = self._fixtures(now)[:max_fixtures]
        if not fixtures:
            print("ℹ️ [OU25] No upcoming fixtures in supported leagues.")
            return {"status": "success", "evaluated": 0, "published": 0}

        existing = self._existing([f["id"] for f in fixtures])  # after any wipe: settled rows stay protected
        leagues = sorted({(f.get("league") or {}).get("code") for f in fixtures} - {None})
        histories = load_histories(leagues, now=now)
        odds_rows = load_upcoming_odds()
        odds_by_league: Dict[str, list] = defaultdict(list)
        for o in odds_rows:
            odds_by_league[o.league].append(o)
        today = now.timestamp() / 86400.0
        ratings = {
            lg: ou_model.league_ratings(h.days, h.home, h.away, h.hg, h.ag, as_of_day=math.floor(today) + 1)
            for lg, h in histories.items()
        }
        print(f"📊 [OU25] {len(fixtures)} fixtures, {len(histories)} leagues with history, "
              f"{len(odds_rows)} odds rows.")

        stats = defaultdict(int)
        records: List[Dict[str, Any]] = []
        candidates_cache: Dict[str, List[str]] = {}
        keep_ids = set()

        for f in fixtures:
            fid = f["id"]
            league = f.get("league") or {}
            lg = league.get("code")
            kickoff_at = f.get("target_kickoff_at")
            hist, rat = histories.get(lg), ratings.get(lg)
            if not kickoff_at or not hist or not rat:
                stats["no_history"] += 1
                continue

            prev = existing.get(fid)
            if prev:
                if prev.get("settlement_status") in ("won", "lost", "void"):
                    stats["already_settled"] += 1
                    keep_ids.add(fid)
                    continue
                k = datetime.fromisoformat(kickoff_at.replace("Z", "+00:00"))
                if k <= lock_until:
                    stats["locked_48h"] += 1   # DB trigger freezes these; leave them
                    keep_ids.add(fid)
                    continue

            if lg not in candidates_cache:
                candidates_cache[lg] = sorted(set(hist.home) | set(hist.away))
            h_key, h_disp = _slug_or_name(f, "home", 1)
            a_key, a_disp = _slug_or_name(f, "away", 2)
            fd_h = best_match(h_key, candidates_cache[lg])
            fd_a = best_match(a_key, candidates_cache[lg])
            if not fd_h or not fd_a or fd_h == fd_a:
                stats["team_not_matched"] += 1
                continue

            rp = ou_model.raw_probability(rat, fd_h, fd_a)
            if not rp:
                stats["insufficient_sample"] += 1
                continue
            p_raw, lam_h, lam_a = rp

            # Bookmaker price: same site, same spelling, kickoff within a day
            p_market, odds = None, None
            kday = kickoff_at[:10]
            for o in odds_by_league.get(lg, []):
                if o.home == fd_h and o.away == fd_a and abs(
                        (datetime.fromisoformat(o.date) - datetime.fromisoformat(kday)).days) <= 1:
                    p_market, odds = devig(o.over, o.under), o
                    break

            p_over = ou_model.calibrated_over(p_raw, p_market)
            pick = ou_model.choose_pick(p_over, p_market is not None, lg)
            if not pick:
                stats["no_edge"] += 1
                continue
            side, tier, p_side = pick
            stats[tier] += 1
            keep_ids.add(fid)

            rationale, tempo = _rationale(side, lam_h, lam_a, p_side, p_market, h_disp, a_disp)
            h_form, a_form = _team_form(hist, fd_h), _team_form(hist, fd_a)
            h2h = _h2h_rate(hist, fd_h, fd_a)
            ht_p = 1.0 - math.exp(-(lam_h + lam_a) * 0.44)
            records.append({
                "fixture_id": fid,
                "market": MARKET,
                "predicted_outcome": side,
                "probability": round(p_side, 4),
                "confidence_tier": tier,
                "xg_combined": round(lam_h + lam_a, 2),
                "home_over25_rate": h_form,
                "away_over25_rate": a_form,
                "h2h_over25_rate": h2h if h2h is not None else (
                    int(round(((h_form or 50) + (a_form or 50)) / 2))),
                "ht_goal_frequency": int(round(ht_p * 100)),
                "avg_first_goal_minute": max(15, min(36, int(35 - (ht_p * 18)))),
                "target_kickoff_at": kickoff_at,
                "settlement_status": "pending",
                "metadata": {
                    "model_version": MODEL_VERSION,
                    "home_team": h_disp,
                    "away_team": a_disp,
                    "league": clean_league_name(league.get("name") or lg),
                    "side": side,
                    "tier": tier,
                    "lambda_home": round(lam_h, 2),
                    "lambda_away": round(lam_a, 2),
                    "p_over_raw": round(p_raw, 4),
                    "p_over_calibrated": round(p_over, 4),
                    "p_under_calibrated": round(1 - p_over, 4),
                    "p_over_market": round(p_market, 4) if p_market is not None else None,
                    "odds_over": odds.over if odds else None,
                    "odds_under": odds.under if odds else None,
                    "has_odds": p_market is not None,
                    "source_names": [fd_h, fd_a],
                    "tactical_rationale": rationale,
                    "goal_tempo": tempo,
                    "ai_source": "ou25-v2",
                    "generated_at": now_iso,
                },
            })

        for i in range(0, len(records), 50):
            self.db.post("goals_predictions", records[i:i + 50], on_conflict="fixture_id,market")

        # Drop stale pending v1/v2 picks beyond the 48h lock that no longer qualify.
        stale = [fid for fid, r in existing.items()
                 if fid not in keep_ids and r.get("settlement_status") == "pending"
                 and datetime.fromisoformat(r["target_kickoff_at"].replace("Z", "+00:00")) > lock_until]
        for i in range(0, len(stale), 100):
            self.db.delete("goals_predictions", {
                "market": f"eq.{MARKET}", "settlement_status": "eq.pending",
                "fixture_id": f"in.({','.join(stale[i:i + 100])})",
            })

        overs = sum(1 for r in records if r["predicted_outcome"] == "OVER_2.5")
        print(f"✅ [OU25] Published {len(records)} picks ({overs} Over, {len(records) - overs} Under). "
              f"Removed {len(stale)} stale picks. Breakdown: {dict(stats)}")
        return {
            "status": "success",
            "evaluated": len(fixtures),
            "published": len(records),
            "over25_published": overs,
            "under25_published": len(records) - overs,
            "removed_stale": len(stale),
            "breakdown": dict(stats),
        }


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="Over/Under 2.5 engine v2")
    ap.add_argument("--wipe-pending", action="store_true")
    a = ap.parse_args()
    print(Over25GoalsEngine().run(wipe_pending=a.wipe_pending))
