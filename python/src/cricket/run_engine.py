"""
Cricket engine runner: scrape, simulate, screen, publish and settle.

    python -m python.src.cricket.run_engine predict [--days 4] [--dry-run]
    python -m python.src.cricket.run_engine settle  [--dry-run]

predict:
  1. Build the model from Cricsheet history (cached between runs).
  2. Scrape LiveScore fixtures for today and the next --days days (men's
     T20I, ODI and the major T20 leagues).
  3. Before the toss: 'provisional' prediction from each team's most recent
     XI, averaged over both possible batting orders.
     After the toss with XIs announced: 'toss' prediction from the real XI
     and the real batting order.
  4. Calibrate with the back-test blend, screen, and insert. New rows never
     overwrite. A 'provisional' row may be refreshed while the match is more
     than 48 hours away; from 48 hours before the start (and once settled) the
     database trigger keeps it unchanged.

settle:
  Reads pending predictions whose match should be over, scrapes the result
  from LiveScore and marks won / lost / void.

Writes go to Supabase with the service role (SUPABASE_URL and
SUPABASE_SERVICE_ROLE_KEY), like the other engines.
"""

from __future__ import annotations

import argparse
import logging
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

import httpx
import numpy as np

from python.src.cricket.calibration import logit, sigmoid
from python.src.cricket.history import download_archives, load_archives, load_cache, save_cache
from python.src.cricket.identity import Register, norm, recent_team_pools
from python.src.cricket.model import CricketModel, venue_key
from python.src.cricket.scrapers.livescore import Fixture, LiveScoreCricket
from python.src.cricket.simulator import Simulator, team_sheet

logger = logging.getLogger("cricket.engine")

MODEL_VERSION = "cricket-v1"
N_SIMS = 20000
KNOWN_BALLS = 60

# Calibration blend fitted on the walk-forward back-test (6,573 T20 and 854
# ODI predictions, Oct 2019 - Nov 2026). Features: logit(simulator p),
# logit(same-format Elo p), logit(other-format Elo p), bat-first perspective.
BLEND = {
    "T20": (-0.2126, 0.9530, 0.4156, 0.3459),
    "ODI": (-0.0844, 0.5478, 0.4148, 0.1437),
}

# Tiers. ELITE stays off until a back-test shows 90%+ on 200+ picks in both
# the selection and test periods (owner decision, 21 Nov 2026).
ELITE_ENABLED = False
DAYS_AHEAD = 4    # predict today plus the next 4 days
LOCK_HOURS = 48   # picks never change within 48h of the start (DB trigger enforces it)
ELITE_MIN_PROB = 0.80
STANDARD_MIN_PROB = 0.65
MIN_RATED_PLAYERS = 9

# LiveScore -> Cricsheet team names where they differ.
TEAM_ALIASES = {
    "uae": "united arab emirates",
    "usa": "united states of america",
    "png": "papua new guinea",
}

# LiveScore stage name -> Cricsheet archive key (the model's competition factor)
LEAGUE_KEYS = (
    ("indian premier league", "ipl"), ("big bash", "bbl"), ("pakistan super league", "psl"),
    ("caribbean premier", "cpl"), ("sa20", "sat"), ("the hundred", "hnd"), ("blast", "ntb"),
    ("bangladesh premier", "bpl"), ("international league t20", "ilt"),
    ("major league cricket", "mlc"), ("super smash", "ssm"), ("lanka premier", "lpl"),
)


def league_key(stage: str, country: str = "") -> Optional[str]:
    s = f"{country} {stage}".lower()
    for kw, key in LEAGUE_KEYS:
        if kw in s:
            return key
    return None


DATA_DIR = os.environ.get("CRICKET_DATA_DIR", "cricket_data")


# ----------------------------------------------------------------- supabase
class Supa:
    def __init__(self, dry_run: bool):
        self.dry = dry_run
        self.url = os.environ.get("SUPABASE_URL", "").rstrip("/")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
        if not dry_run and not (self.url and key):
            raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (or use --dry-run)")
        self.h = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        self.c = httpx.Client(timeout=30)

    def upsert(self, table: str, rows: List[dict], on_conflict: str, ignore_duplicates: bool = False) -> None:
        if not rows:
            return
        if self.dry:
            logger.info("[dry-run] %s: %d rows", table, len(rows))
            return
        res = "ignore-duplicates" if ignore_duplicates else "merge-duplicates"
        r = self.c.post(f"{self.url}/rest/v1/{table}", params={"on_conflict": on_conflict},
                        headers={**self.h, "Prefer": f"resolution={res},return=minimal"}, json=rows)
        if r.status_code >= 300:
            raise RuntimeError(f"upsert {table}: {r.status_code} {r.text[:300]}")

    def select(self, table: str, params: dict) -> List[dict]:
        if not self.url:
            return []
        r = self.c.get(f"{self.url}/rest/v1/{table}", params=params, headers=self.h)
        if r.status_code >= 300:
            raise RuntimeError(f"select {table}: {r.status_code} {r.text[:300]}")
        return r.json()

    def patch(self, table: str, match: dict, values: dict) -> None:
        if self.dry:
            logger.info("[dry-run] patch %s %s -> %s", table, match, values)
            return
        r = self.c.patch(f"{self.url}/rest/v1/{table}", params=match,
                         headers={**self.h, "Prefer": "return=minimal"}, json=values)
        if r.status_code >= 300:
            raise RuntimeError(f"patch {table}: {r.status_code} {r.text[:300]}")


# ----------------------------------------------------------------- model
def build_model(refresh: bool) -> Tuple[CricketModel, List[dict]]:
    os.makedirs(DATA_DIR, exist_ok=True)
    cache = os.path.join(DATA_DIR, "history.json.gz")
    if refresh or not os.path.exists(cache):
        save_cache(load_archives(download_archives(DATA_DIR)), cache)
    matches = load_cache(cache)
    model = CricketModel()
    for m in matches:
        model.update(m)
    logger.info("model trained on %d matches (latest %s)", len(matches), matches[-1]["date"])
    return model, matches


class TeamBook:
    """Cricsheet team names, most recent XI per team, and player pools."""

    def __init__(self, matches: List[dict]):
        self.last_xi: Dict[Tuple[str, str], List[str]] = {}
        self.names: Dict[str, str] = {}
        for m in matches:
            for t, xi in m["players"].items():
                self.names[norm(t)] = t
                if len(xi) >= 11:
                    self.last_xi[(m["format"], t)] = xi
        since = (datetime.now(timezone.utc) - timedelta(days=730)).date().isoformat()
        self.pools = recent_team_pools(matches, since)

    def team(self, scraped: str) -> Optional[str]:
        n = norm(scraped)
        n = TEAM_ALIASES.get(n, n)
        return self.names.get(n)

    def probable_xi(self, fmt: str, team: str) -> Optional[List[str]]:
        other = "ODI" if fmt == "T20" else "T20"
        return self.last_xi.get((fmt, team)) or self.last_xi.get((other, team))


def calibrated(fmt: str, model: CricketModel, p_sim: float, bat1: str, bat2: str) -> float:
    other = "ODI" if fmt == "T20" else "T20"
    p_elo = model.elo_prob(fmt, bat1, bat2)
    if min(model.elo_games[(other, bat1)], model.elo_games[(other, bat2)]) >= 5:
        p_other = model.elo_prob(other, bat1, bat2)
    else:
        p_other = 0.5
    w = BLEND[fmt]
    z = w[0] + w[1] * logit(p_sim) + w[2] * logit(p_elo) + w[3] * logit(p_other)
    return float(sigmoid(z))


def rated_count(model: CricketModel, fmt: str, xi: List[str]) -> int:
    return sum(1 for p in xi if model.balls_faced(fmt, p) + model.balls_bowled(fmt, p) >= KNOWN_BALLS)


def resolve_lineup(reg: Register, book: TeamBook, team: str, lineup: List[dict]) -> Tuple[List[str], int]:
    ids, unmatched = [], 0
    pool = book.pools.get(norm(team))
    for p in lineup:
        r = reg.resolve(provider_col="key_bigbash", provider_id=p.get("provider_id"),
                        full_names=[p.get("full_name") or "", p.get("name") or ""], team_pool=pool)
        if r.player_id:
            ids.append(r.player_id)
        else:
            unmatched += 1
            ids.append(f"unmatched:{p.get('name')}")  # simulated as an average player
    return ids, unmatched


def predict_fixture(model: CricketModel, book: TeamBook, reg: Register, fx: Fixture) -> Optional[dict]:
    fmt = fx.fmt
    home, away = book.team(fx.home), book.team(fx.away)
    if not home or not away:
        logger.info("skip %s v %s: team not in history", fx.home, fx.away)
        return None
    toss_ready = bool(fx.toss_winner and fx.toss_decision and len(fx.lineups) == 2
                      and all(len(v) >= 11 for v in fx.lineups.values()))
    unmatched = 0
    if toss_ready:
        xi_h, u1 = resolve_lineup(reg, book, home, fx.lineups.get(fx.home, []))
        xi_a, u2 = resolve_lineup(reg, book, away, fx.lineups.get(fx.away, []))
        unmatched = u1 + u2
        toss_team = home if fx.toss_winner == fx.home else away
        other_team = away if toss_team == home else home
        bat1 = toss_team if fx.toss_decision == "bat" else other_team
        stage = "toss"
    else:
        xi_h, xi_a = book.probable_xi(fmt, home), book.probable_xi(fmt, away)
        if not xi_h or not xi_a:
            logger.info("skip %s v %s: no recent XI", home, away)
            return None
        bat1 = None
        stage = "provisional"
    sheets = {home: team_sheet(model, fmt, home, xi_h), away: team_sheet(model, fmt, away, xi_a)}
    sim = Simulator(model, fmt, N_SIMS, None, league_key(fx.stage, fx.country),
                    venue_key({"venue": fx.venue or ""}))

    def p_home_given(first: str) -> Tuple[float, float]:
        second = away if first == home else home
        res = sim.simulate(sheets[first], sheets[second])
        p_first = calibrated(fmt, model, res.p_bat_first_wins + 0.5 * res.p_tie, first, second)
        return (p_first if first == home else 1 - p_first), float(np.median(res.first_innings_runs))

    if bat1:
        p_home, r1 = p_home_given(bat1)
    else:  # toss unknown: average both batting orders
        (a, r_a), (b, r_b) = p_home_given(home), p_home_given(away)
        p_home, r1 = (a + b) / 2, (r_a + r_b) / 2
    fav = fx.home if p_home >= 0.5 else fx.away
    prob = max(p_home, 1 - p_home)
    rated = {fx.home: rated_count(model, fmt, xi_h), fx.away: rated_count(model, fmt, xi_a)}
    screened = min(rated.values()) >= MIN_RATED_PLAYERS and unmatched == 0
    if ELITE_ENABLED and screened and stage == "toss" and prob >= ELITE_MIN_PROB:
        tier = "ELITE"
    elif screened and prob >= STANDARD_MIN_PROB:
        tier = "STANDARD"
    else:
        tier = "WATCH"
    return {
        "fixture_id": fx.event_id, "stage": stage, "model_version": MODEL_VERSION,
        "start_time": fx.start_utc, "home_win_prob": round(p_home, 4), "away_win_prob": round(1 - p_home, 4),
        "predicted_winner": fav, "probability": round(prob, 4), "tier": tier,
        "bat_first": (fx.home if bat1 == home else fx.away) if bat1 else None,
        "first_innings_median": round(r1, 1), "players_rated": rated, "unmatched_players": unmatched,
    }


def fixture_row(fx: Fixture) -> dict:
    return {
        "id": fx.event_id, "format": fx.fmt, "competition": fx.stage, "country": fx.country,
        "home_team": fx.home, "away_team": fx.away, "start_time": fx.start_utc, "venue": fx.venue,
        "city": fx.city, "status": fx.status, "toss_winner": fx.toss_winner,
        "toss_decision": fx.toss_decision, "result_text": fx.result_text,
        "winner": winner_from_text(fx.result_text, fx.home, fx.away) if fx.status == "finished" else None,
        "scores": fx.innings, "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def run_predict(days: int, dry_run: bool, refresh: bool) -> int:
    db = Supa(dry_run)
    ls = LiveScoreCricket()
    today = datetime.now(timezone.utc).date()
    fixtures: List[Fixture] = []
    for d in range(-1, days + 1):
        fixtures.extend(ls.fixtures((today + timedelta(days=d)).strftime("%Y%m%d")))
    fixtures = [f for f in fixtures if f.fmt in ("T20", "ODI") and f.start_utc]
    logger.info("%d in-scope fixtures", len(fixtures))
    if not fixtures:
        return 0
    for fx in fixtures:
        ls.enrich(fx)
    db.upsert("cricket_fixtures", [fixture_row(f) for f in fixtures], "id")

    existing = {(r["fixture_id"], r["stage"]) for r in db.select(
        "cricket_predictions", {"select": "fixture_id,stage",
                                "fixture_id": f"in.({','.join(f.event_id for f in fixtures)})"})}
    # Only matches that have not started: nothing is ever published after the first ball.
    now_iso = datetime.now(timezone.utc).isoformat()
    todo = [f for f in fixtures if f.status == "scheduled" and f.start_utc > now_iso]
    if not todo:
        logger.info("no unstarted fixtures to predict")
        return 0
    model, matches = build_model(refresh)
    book = TeamBook(matches)
    reg = Register.download(DATA_DIR)
    rows: List[dict] = []
    refresh_rows: List[dict] = []
    for fx in todo:
        try:
            p = predict_fixture(model, book, reg, fx)
        except Exception as exc:  # one bad fixture must not stop the run
            logger.exception("predict %s failed: %s", fx.event_id, exc)
            continue
        if not p:
            continue
        key = (p["fixture_id"], p["stage"])
        if key not in existing:
            rows.append(p)
        elif is_refreshable(p["start_time"]):
            refresh_rows.append(p)
        else:
            continue
        logger.info("%s %s v %s: %s %.1f%% (%s)%s", p["stage"], fx.home, fx.away,
                    p["predicted_winner"], p["probability"] * 100, p["tier"],
                    " [refresh]" if key in existing else "")
    # New rows never overwrite anything.
    db.upsert("cricket_predictions", rows, "fixture_id,stage", ignore_duplicates=True)
    # Rows more than 48h out may be refreshed; the database trigger keeps every
    # row within 48h of the start (or settled) unchanged regardless.
    db.upsert("cricket_predictions", refresh_rows, "fixture_id,stage", ignore_duplicates=False)
    logger.info("published %d new, refreshed %d unlocked predictions", len(rows), len(refresh_rows))
    return len(rows) + len(refresh_rows)


def is_refreshable(start_iso: str, now: Optional[datetime] = None) -> bool:
    """True while a match is comfortably more than LOCK_HOURS away (5 min margin)."""
    now = now or datetime.now(timezone.utc)
    start = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
    return start - now > timedelta(hours=LOCK_HOURS, minutes=5)


# ----------------------------------------------------------------- settle
WIN_RE = re.compile(r"^(?P<team>.+?)\s+(?:win|won|beat)\b", re.I)


def winner_from_text(text: Optional[str], home: str, away: str) -> Optional[str]:
    if not text:
        return None
    t = text.strip()
    if re.search(r"no result|abandon|tied|match drawn", t, re.I) and not re.search(r"super over", t, re.I):
        return None
    m = WIN_RE.match(t)
    if not m:
        return None
    name = norm(m.group("team"))
    for team in (home, away):
        n = norm(team)
        if name == n or name.startswith(n) or n.startswith(name):
            return team
    return None


def run_settle(dry_run: bool) -> int:
    db = Supa(dry_run)
    ls = LiveScoreCricket()
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat()
    pending = db.select("cricket_predictions", {
        "select": "id,fixture_id,predicted_winner", "settlement_status": "eq.pending",
        "start_time": f"lt.{cutoff}", "limit": "500"})
    by_fixture: Dict[str, List[dict]] = {}
    for p in pending:
        by_fixture.setdefault(p["fixture_id"], []).append(p)
    fx_rows = {r["id"]: r for r in db.select("cricket_fixtures", {
        "select": "id,home_team,away_team,format,competition,start_time",
        "id": f"in.({','.join(by_fixture) or '0'})"})} if by_fixture else {}
    n = 0
    for fid, preds in by_fixture.items():
        meta = fx_rows.get(fid)
        if not meta:
            continue
        fx = Fixture(event_id=fid, stage=meta["competition"], country="", fmt=meta["format"],
                     home=meta["home_team"], away=meta["away_team"], home_id=None, away_id=None,
                     start_utc=meta["start_time"], status="scheduled", round_info=None, result_text=None)
        try:
            ls.enrich(fx)
        except Exception as exc:
            logger.warning("settle %s: %s", fid, exc)
            continue
        db.upsert("cricket_fixtures", [fixture_row(fx)], "id")
        now = datetime.now(timezone.utc).isoformat()
        if fx.status == "abandoned":
            status, winner = "void", None
        elif fx.status == "finished":
            winner = winner_from_text(fx.result_text, fx.home, fx.away)
            if winner is None:
                status = "void"  # tie without super over, no result
            else:
                status = None
        else:
            continue
        for p in preds:
            st = status or ("won" if p["predicted_winner"] == winner else "lost")
            db.patch("cricket_predictions", {"id": f"eq.{p['id']}"},
                     {"settlement_status": st, "actual_winner": winner, "settled_at": now})
            n += 1
    logger.info("settled %d predictions", n)
    return n


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("predict")
    p.add_argument("--days", type=int, default=DAYS_AHEAD)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--refresh-history", action="store_true")
    s = sub.add_parser("settle")
    s.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if args.cmd == "predict":
        run_predict(args.days, args.dry_run, args.refresh_history)
    else:
        run_settle(args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
