"""
Walk-forward back-test for the cricket match-winner model.

Stage 1 (simulate): replay history in date order. For each match from
--eval-start, predict it using only what the model learned from earlier
matches, then let the model learn from it. The prediction is the toss-time
one: the toss and both announced XIs are known (they are, 30 minutes before
the first ball); batting order and bowling plans come from each player's
past matches, never from this match.

Stage 2 (analyse): fit the calibration blend month by month on earlier
predictions only, choose the Elite cut-off on the selection period, then
score it on the later, untouched test period.

    python -m python.src.cricket.backtest simulate --cache history.json.gz --out preds.jsonl
    python -m python.src.cricket.backtest analyse --preds preds.jsonl --report report.md
"""

from __future__ import annotations

import argparse
import json
import logging
import time
from collections import defaultdict
from typing import Dict, List

import numpy as np

from python.src.cricket.calibration import (
    LogisticBlend, brier, calibration_table, logit, wilson_lower,
)
from python.src.cricket.history import load_cache
from python.src.cricket.model import CricketModel, competition_key, venue_key
from python.src.cricket.simulator import Simulator, team_sheet

logger = logging.getLogger("cricket.backtest")

KNOWN_BALLS = 60  # a player counts as "rated" with 60+ decayed balls in the format

LEAGUES = {"ipl", "bbl", "psl", "cpl", "sat", "hnd", "ntb", "bpl", "ilt", "mlc", "ssm", "lpl"}


def competition_group(m: dict) -> str:
    if m["source"] in LEAGUES:
        return "T20 league"
    return "T20I" if m["format"] == "T20" else "ODI"


def predictable(m: dict) -> bool:
    if m["result"] == "no result" or len(m["innings"]) < 2:
        return False
    xi = [m["players"].get(t, []) for t in m["teams"]]
    return all(len(x) >= 11 for x in xi) and m["innings"][0]["team"] in m["teams"]


def simulate(cache: str, out: str, eval_start: str, n_sims: int, half_life: float,
             prior_bat: float, prior_bowl: float, seed: int = 7,
             shard: int = 0, shards: int = 1) -> None:
    """Every shard replays the full history (cheap) but simulates only the
    matches with index % shards == shard, so shards run in parallel and
    produce identical predictions to a single run."""
    matches = load_cache(cache)
    model = CricketModel(half_life, prior_bat, prior_bowl)
    t0 = time.time()
    n_pred = 0
    with open(out, "w") as fh:
        for i, m in enumerate(matches):
            if m["date"] >= eval_start and i % shards == shard and predictable(m):
                fmt = m["format"]
                other = "ODI" if fmt == "T20" else "T20"
                model.t = max(model.t, _day(m["date"]))
                first = m["innings"][0]["team"]
                second = [t for t in m["teams"] if t != first][0]
                s1 = team_sheet(model, fmt, first, m["players"][first])
                s2 = team_sheet(model, fmt, second, m["players"][second])
                sim = Simulator(model, fmt, n_sims, seed + i, competition_key(m), venue_key(m))
                res = sim.simulate(s1, s2, m.get("overs"))
                p_sim = res.p_bat_first_wins + 0.5 * res.p_tie
                rated = []
                for t in (first, second):
                    xi = m["players"][t]
                    k = sum(1 for p in xi if model.balls_faced(fmt, p) + model.balls_bowled(fmt, p) >= KNOWN_BALLS)
                    rated.append(k)
                if m.get("winner") == first:
                    y = 1.0
                elif m.get("winner") == second:
                    y = 0.0
                else:
                    y = 0.5
                rec = {
                    "id": m["id"], "date": m["date"], "format": fmt,
                    "group": competition_group(m), "competition": m["competition"],
                    "bat_first": first, "bat_second": second,
                    "p_sim": round(p_sim, 4), "p_elo": round(model.elo_prob(fmt, first, second), 4),
                    "p_elo_other": round(model.elo_prob(other, first, second), 4)
                    if min(model.elo_games[(other, first)], model.elo_games[(other, second)]) >= 5 else 0.5,
                    "elo_games_min": min(model.elo_games[(fmt, first)], model.elo_games[(fmt, second)]),
                    "rated_min": min(rated),
                    "sim_r1_median": float(np.median(res.first_innings_runs)),
                    "r1_actual": sum(b[5] for b in m["innings"][0]["balls"]),
                    "method": m.get("method"), "y": y,
                }
                fh.write(json.dumps(rec) + "\n")
                n_pred += 1
                if n_pred % 250 == 0:
                    logger.info("%d predictions (%s), %.0fs", n_pred, m["date"], time.time() - t0)
            model.update(m)
    logger.info("done: %d predictions in %.0fs", n_pred, time.time() - t0)


def _day(date: str) -> int:
    from python.src.cricket.model import day_number
    return day_number(date)


# ---------------------------------------------------------------------- analyse
def load_preds(path: str) -> List[dict]:
    rows = []
    for p in path.split(","):
        with open(p) as fh:
            rows.extend(json.loads(l) for l in fh if l.strip())
    return sorted(rows, key=lambda r: (r["date"], r["id"]))


def features(rows: List[dict]) -> np.ndarray:
    ps = np.array([r["p_sim"] for r in rows])
    pe = np.array([r["p_elo"] for r in rows])
    po = np.array([r.get("p_elo_other", 0.5) for r in rows])
    return np.column_stack([logit(ps), logit(pe), logit(po)])


def walk_forward_blend(rows: List[dict], min_train: int = 400) -> List[dict]:
    """Add 'p' (calibrated, bat-first wins) fitted per format on earlier months only."""
    rows = [r for r in rows if r["y"] in (0.0, 1.0)]  # ties excluded from scoring
    by_month: Dict[str, List[dict]] = defaultdict(list)
    for r in rows:
        by_month[r["date"][:7]].append(r)
    out = []
    history: Dict[str, List[dict]] = defaultdict(list)
    for month in sorted(by_month):
        for fmt in ("T20", "ODI"):
            cur = [r for r in by_month[month] if r["format"] == fmt]
            if not cur:
                continue
            train = history[fmt]
            if len(train) >= min_train:
                blend = LogisticBlend(l2=1.0).fit(features(train), np.array([r["y"] for r in train]))
                p = blend.predict(features(cur))
                for r, pi in zip(cur, p):
                    out.append({**r, "p": float(pi)})
            history[fmt].extend(cur)
    return out


def screen(r: dict, min_rated: int, min_games: int) -> bool:
    return r["rated_min"] >= min_rated and r["elo_games_min"] >= min_games


def tier_stats(rows: List[dict], cut: float, min_rated: int, min_games: int):
    sel = [r for r in rows if max(r["p"], 1 - r["p"]) >= cut and screen(r, min_rated, min_games)]
    wins = sum(1 for r in sel if (r["p"] >= 0.5) == (r["y"] == 1.0))
    return len(sel), wins


def choose_cut(rows: List[dict], target: float = 0.90, min_picks: int = 150):
    """Lowest cut (most volume) whose selection-period hit rate >= target."""
    best = None
    for min_rated in (8, 9, 10, 11):
        for min_games in (10, 20):
            for cut in np.arange(0.70, 0.991, 0.01):
                n, w = tier_stats(rows, cut, min_rated, min_games)
                if n >= min_picks and w / n >= target:
                    cand = (n, round(float(cut), 2), min_rated, min_games, w)
                    if best is None or cand[0] > best[0]:
                        best = cand
                    break
    return best


def analyse(preds: str, report: str, test_start: str = "2024-01-01") -> dict:
    raw = load_preds(preds)
    rows = walk_forward_blend(raw)
    sel = [r for r in rows if r["date"] < test_start]
    test = [r for r in rows if r["date"] >= test_start]
    y = lambda rs: [r["y"] for r in rs]
    out = {"n_scored": len(rows), "selection_n": len(sel), "test_n": len(test)}
    lines = ["# Cricket engine back-test (walk-forward)", ""]
    lines.append(f"Scored matches: {len(rows)} (selection period {len(sel)}, test period from {test_start}: {len(test)}).")
    lines.append("")
    lines.append("## Match winner, all matches (test period)")
    lines.append("")
    lines.append("| Group | Matches | Hit rate (favourite) | Brier calibrated | Brier Elo only | Brier simulator only |")
    lines.append("| --- | --- | --- | --- | --- | --- |")
    groups = sorted({r["group"] for r in test})
    for g in groups + ["All"]:
        rs = test if g == "All" else [r for r in test if r["group"] == g]
        if not rs:
            continue
        hit = np.mean([(r["p"] >= 0.5) == (r["y"] == 1.0) for r in rs])
        lines.append(f"| {g} | {len(rs)} | {hit:.1%} | {brier([r['p'] for r in rs], y(rs)):.4f} | "
                     f"{brier([r['p_elo'] for r in rs], y(rs)):.4f} | {brier([r['p_sim'] for r in rs], y(rs)):.4f} |")
        out[f"hit_{g}"] = float(hit)
    lines.append("")
    lines.append("## Calibration (test period, favourite's probability)")
    lines.append("")
    lines.append("| Band | Matches | Predicted | Actual |")
    lines.append("| --- | --- | --- | --- |")
    for band, n, pm, act in calibration_table([r["p"] for r in test], y(test)):
        lines.append(f"| {band} | {n} | {pm:.1%} | {act:.1%} |")
    lines.append("")
    best = choose_cut(sel)
    lines.append("## Elite tier")
    lines.append("")
    if best is None:
        lines.append("No cut-off reached 90% on 150+ selection-period picks.")
        out["elite"] = None
    else:
        n_sel, cut, min_rated, min_games, w_sel = best
        n_t, w_t = tier_stats(test, cut, min_rated, min_games)
        weeks = max(1.0, (len({r['date'] for r in test}) and
                          (np.datetime64(max(r['date'] for r in test)) - np.datetime64(test_start)).astype(int) / 7))
        lines.append(f"Rule chosen on the selection period only: favourite probability >= {cut:.0%}, "
                     f"at least {min_rated} of 11 players rated in both XIs, both teams with {min_games}+ rated games.")
        lines.append("")
        lines.append("| Period | Picks | Won | Hit rate | Lower 95% bound | Picks per week |")
        lines.append("| --- | --- | --- | --- | --- | --- |")
        lines.append(f"| Selection (before {test_start}) | {n_sel} | {w_sel} | {w_sel/n_sel:.1%} | {wilson_lower(w_sel, n_sel):.1%} | |")
        if n_t:
            lines.append(f"| Test (from {test_start}, untouched) | {n_t} | {w_t} | {w_t/n_t:.1%} | {wilson_lower(w_t, n_t):.1%} | {n_t/weeks:.1f} |")
        out["elite"] = {"cut": cut, "min_rated": min_rated, "min_games": min_games,
                        "sel_n": n_sel, "sel_hit": w_sel / n_sel, "test_n": n_t,
                        "test_hit": (w_t / n_t) if n_t else None,
                        "test_lower95": wilson_lower(w_t, n_t) if n_t else None,
                        "test_per_week": n_t / weeks}
        # by group on test
        lines.append("")
        lines.append("| Group (test) | Elite picks | Hit rate |")
        lines.append("| --- | --- | --- |")
        for g in groups:
            rs = [r for r in test if r["group"] == g]
            n_g, w_g = tier_stats(rs, cut, min_rated, min_games)
            if n_g:
                lines.append(f"| {g} | {n_g} | {w_g/n_g:.1%} |")
    lines.append("")
    lines.append("## Standard tier (test period)")
    lines.append("")
    lines.append("| Favourite probability | Picks | Hit rate |")
    lines.append("| --- | --- | --- |")
    for lo in (0.6, 0.65, 0.7, 0.75, 0.8, 0.85):
        n, w = tier_stats(test, lo, 0, 0)
        if n:
            lines.append(f"| {lo:.0%} or more | {n} | {w/n:.1%} |")
    lines.append("")
    lines.append("Data: Cricsheet.org (ODC-BY). Bookmaker odds are not yet in this back-test.")
    with open(report, "w") as fh:
        fh.write("\n".join(lines) + "\n")
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("simulate")
    s.add_argument("--cache", required=True)
    s.add_argument("--out", required=True)
    s.add_argument("--eval-start", default="2019-01-01")
    s.add_argument("--sims", type=int, default=2000)
    s.add_argument("--half-life", type=float, default=730.0)
    s.add_argument("--prior-bat", type=float, default=120.0)
    s.add_argument("--prior-bowl", type=float, default=180.0)
    s.add_argument("--shard", type=int, default=0)
    s.add_argument("--shards", type=int, default=1)
    a = sub.add_parser("analyse")
    a.add_argument("--preds", required=True)
    a.add_argument("--report", required=True)
    a.add_argument("--test-start", default="2024-01-01")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    if args.cmd == "simulate":
        simulate(args.cache, args.out, args.eval_start, args.sims,
                 args.half_life, args.prior_bat, args.prior_bowl,
                 shard=args.shard, shards=args.shards)
    else:
        print(json.dumps(analyse(args.preds, args.report, args.test_start), indent=2))


if __name__ == "__main__":
    main()
