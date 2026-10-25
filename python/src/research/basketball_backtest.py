"""
Walk-forward backtest for basketball ratings v2 (Phase 1, shadow only).

Read-only. Pulls finished fixtures from Supabase with GET requests only, replays them in kickoff
order, and prints how v2 would have done: total-points bias and error, margin error, and winner
accuracy, overall, for games where both teams had 3+ earlier games, and per league.

Writes nothing, imports nothing from the live engines, and no workflow runs it automatically.
    python -m python.src.research.basketball_backtest
    python -m python.src.research.basketball_backtest --from-json games.json --k 0.1

JSON form: {"rows": [[kickoff, league, quarter_minutes, home, away, home_score, away_score], ...]}
"""

from __future__ import annotations

import argparse
import json
import os
from typing import Dict, List

from python.src.basketball.ratings_v2 import Game, PointsRatingModel, evaluate

PAGE = 1000


def load_from_supabase() -> List[Game]:
    import httpx  # local import so --from-json works offline

    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (or use --from-json).")
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    games: List[Game] = []
    offset = 0
    with httpx.Client(base_url=f"{url}/rest/v1", headers=headers, timeout=30.0) as client:
        while True:
            resp = client.get(
                "/basketball_fixtures",
                params={
                    "select": "id,target_kickoff_at,home_team_id,away_team_id,home_score,away_score,"
                              "league:basketball_leagues(code,quarter_minutes)",
                    "status": "eq.finished",
                    "home_score": "not.is.null",
                    "away_score": "not.is.null",
                    "order": "target_kickoff_at.asc,id.asc",
                    "limit": str(PAGE),
                    "offset": str(offset),
                },
            )
            resp.raise_for_status()
            chunk = resp.json()
            for r in chunk:
                lg = r.get("league") or {}
                games.append(Game(
                    kickoff=r["target_kickoff_at"],
                    league=lg.get("code") or "UNKNOWN",
                    quarter_minutes=int(lg.get("quarter_minutes") or 10),
                    home=str(r["home_team_id"]), away=str(r["away_team_id"]),
                    home_score=int(r["home_score"]), away_score=int(r["away_score"]),
                ))
            if len(chunk) < PAGE:
                break
            offset += PAGE
    return games


def load_from_json(path: str) -> List[Game]:
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    return [Game(kickoff=r[0], league=r[1], quarter_minutes=int(r[2]), home=str(r[3]), away=str(r[4]),
                 home_score=int(r[5]), away_score=int(r[6])) for r in data["rows"]]


def run(games: List[Game], k: float = 0.10) -> Dict[str, object]:
    preds = PointsRatingModel(k=k).replay(games)
    by_league: Dict[str, object] = {}
    for code in sorted({p.game.league for p in preds}):
        r = evaluate(preds, lambda p, c=code: p.game.league == c)
        if r["n"] >= 15:
            by_league[code] = r
    return {
        "games": len(preds),
        "all": evaluate(preds),
        "both_teams_3plus_prior": evaluate(preds, lambda p: p.home_prior_games >= 3 and p.away_prior_games >= 3),
        "by_league": by_league,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Basketball ratings v2 walk-forward backtest (read-only).")
    ap.add_argument("--from-json", dest="json_path", default=None)
    ap.add_argument("--k", type=float, default=0.10)
    args = ap.parse_args()
    games = load_from_json(args.json_path) if args.json_path else load_from_supabase()
    print(json.dumps(run(games, k=args.k), indent=2))


if __name__ == "__main__":
    main()
