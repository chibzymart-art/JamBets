"""
Oddsbanta basketball prediction path v2.

Used by run_predictions.py only when BASKETBALL_MODEL=v2. With the variable unset, nothing here runs.

What it changes compared with v1, and why (all measured on finished games before shipping):
1. Expected scores come from ratings_v2 (each finished game learned once, in order; league scoring
   level learned from the league itself). v1 put NBA totals 26 points low and CBA totals 46 low.
2. The score spread in the simulation is the model's measured error for that kind of game, not a
   fixed formula. v1 stated 91.5% on Banger moneylines that won 71.2%.
3. No probability clamps. The probability saved is the probability the model computed.
4. Without a bookmaker line, spread and total picks use the line where the model's own probability
   is closest to 68%, inside 60-75%, so a "pick" is never an ultra-safe line dressed up as a forecast.
5. Tiers are set on that calibrated probability, and the top two tiers also need both teams to have
   at least 3 earlier games, so thin-history games cannot be sold as Bangers.

Reads finished fixtures (GET only). Writes nothing itself; run_predictions saves what it returns.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from python.src.basketball.config import LEAGUE_REGISTRY
from python.src.basketball.models import BasketballConfidenceTier, BasketballMarket, BasketballPredictionModel
from python.src.basketball.monte_carlo import BasketballMonteCarloSimulator
from python.src.basketball.ratings_v2 import Game, PointsRatingModel

logger = logging.getLogger("basketball.v2_engine")

MODEL_VERSION = "ratings_v2.1"
PAGE = 1000
SYNTH_TARGET = 0.68
SYNTH_BAND = (0.60, 0.75)

# Calibrated-probability tier floors. Bangers and Top Picks also need both teams with 3+ earlier games.
BANGER_FLOOR = 0.85
TOP_PICK_FLOOR = 0.75
HIGH_FLOOR = 0.65
MID_FLOOR = 0.55
LOW_FLOOR = 0.50
MIN_PRIOR_FOR_TOP_TIERS = 3


def load_history(db) -> List[Game]:
    """All finished fixtures with scores, oldest first, paged so none are dropped."""
    leagues = db.client.get("/basketball_leagues", params={"select": "id,code,quarter_minutes", "limit": "1000"}).json()
    lg_map = {l["id"]: (l.get("code") or "UNKNOWN", int(l.get("quarter_minutes") or 10)) for l in leagues}
    games: List[Game] = []
    offset = 0
    while True:
        resp = db.client.get(
            "/basketball_fixtures",
            params={
                "select": "id,target_kickoff_at,league_id,home_team_id,away_team_id,home_score,away_score",
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
            code, qm = lg_map.get(r.get("league_id"), ("UNKNOWN", 10))
            games.append(Game(
                kickoff=r["target_kickoff_at"], league=code, quarter_minutes=qm,
                home=str(r["home_team_id"]), away=str(r["away_team_id"]),
                home_score=int(r["home_score"]), away_score=int(r["away_score"]),
            ))
        if len(chunk) < PAGE:
            break
        offset += PAGE
    return games


def build_model(games: List[Game], carryover: float = 1.0) -> PointsRatingModel:
    model = PointsRatingModel(carryover=carryover)
    model.replay(games)
    return model


def sim_spread(margin_sd: float, total_sd: float) -> Tuple[float, float]:
    """Per-team sigma and home/away correlation that reproduce the measured margin and total errors."""
    sm2, st2 = margin_sd ** 2, total_sd ** 2
    sigma = ((sm2 + st2) / 4.0) ** 0.5
    rho = (st2 - sm2) / (st2 + sm2)
    return sigma, max(-0.9, min(0.9, rho))


def _pick_synthetic(options: List[Tuple[float, float, str]]) -> Tuple[float, float, str]:
    """options: (line, probability, text). Closest to 68% inside 60-75%, else closest to 68% overall."""
    inside = [o for o in options if SYNTH_BAND[0] <= o[1] <= SYNTH_BAND[1]]
    pool = inside or options
    return min(pool, key=lambda o: (abs(o[1] - SYNTH_TARGET), abs(o[0])))


def tier_for(prob: float, min_prior: int) -> BasketballConfidenceTier:
    known = min_prior >= MIN_PRIOR_FOR_TOP_TIERS
    if prob >= BANGER_FLOOR and known:
        return BasketballConfidenceTier.BANGER
    if prob >= TOP_PICK_FLOOR and known:
        return BasketballConfidenceTier.TOP_PICK
    if prob >= HIGH_FLOOR:
        return BasketballConfidenceTier.HIGH_CONFIDENCE
    if prob >= MID_FLOOR:
        return BasketballConfidenceTier.MID_CONFIDENCE
    if prob >= LOW_FLOOR:
        return BasketballConfidenceTier.LOW_CONFIDENCE
    return BasketballConfidenceTier.RISKY


def _secondary_tier(prob: float, min_prior: int) -> str:
    t = tier_for(prob, min_prior)
    if t == BasketballConfidenceTier.BANGER:
        t = BasketballConfidenceTier.TOP_PICK  # secondaries never carry the Banger label
    return t.value


def predict_fixture(model: PointsRatingModel, fix: Dict[str, Any], simulator: BasketballMonteCarloSimulator,
                    num_sims: int) -> BasketballPredictionModel:
    league = fix.get("league") or {}
    code = (league.get("code") or "UNKNOWN").upper()
    qm = int(league.get("quarter_minutes") or (LEAGUE_REGISTRY[code].quarter_minutes if code in LEAGUE_REGISTRY else 10))
    home = fix.get("home_team") or {}
    away = fix.get("away_team") or {}
    home_name = home.get("canonical_name", "Home Team")
    away_name = away.get("canonical_name", "Away Team")

    g = Game(kickoff=fix["target_kickoff_at"], league=code, quarter_minutes=qm,
             home=str(fix["home_team_id"]), away=str(fix["away_team_id"]), home_score=0, away_score=0)
    p = model.predict(g)
    min_prior = min(p.home_prior_games, p.away_prior_games)
    margin_sd, total_sd = model.errors.sds(qm, min_prior)
    slope = model.errors.slope(qm, min_prior)
    sigma, rho = sim_spread(margin_sd, total_sd)
    # Simulate around the calibrated margin (slope x rated margin) with the rated total unchanged.
    cal_margin = slope * p.expected_margin
    sim_home = (p.expected_total + cal_margin) / 2.0
    sim_away = (p.expected_total - cal_margin) / 2.0

    spread = fix.get("market_spread")
    total = fix.get("market_total")
    home_ml = fix.get("home_moneyline_odds")
    away_ml = fix.get("away_moneyline_odds")
    spread = float(spread) if spread is not None else None
    total = float(total) if total is not None else None

    sim = simulator.simulate(home_mean=sim_home, away_mean=sim_away,
                             market_spread=spread, market_total=total, num_simulations=num_sims,
                             sigma_override=sigma, rho_override=rho)

    candidates: List[Dict[str, Any]] = []

    # Moneyline
    has_ml = home_ml is not None and away_ml is not None
    home_side = sim.home_win_prob >= sim.away_win_prob
    ml_prob = sim.home_win_prob if home_side else sim.away_win_prob
    ml_odds = (float(home_ml) if home_side else float(away_ml)) if has_ml else None
    if has_ml:
        fair, edge = simulator.calculate_ev_edge(ml_prob, ml_odds)
    else:
        fair, edge = round(1.0 / max(0.01, ml_prob), 2), 0.0
    candidates.append({"market": BasketballMarket.MONEYLINE,
                       "prediction": f"{home_name if home_side else away_name} To Win",
                       "probability": round(ml_prob, 4), "fair_odds": fair, "market_odds": ml_odds,
                       "edge_pct": edge, "has_real_odds": has_ml})

    # Point spread
    if spread is not None:
        cover = sim.spread_cover_probs.get(str(float(spread)), 0.5)
        if cover >= 0.5:
            sp_text, sp_prob = f"{home_name} {spread:+.1f} Points", cover
        else:
            sp_text, sp_prob = f"{away_name} {-spread:+.1f} Points", 1.0 - cover
    else:
        opts = []
        for sp_str, cover in sim.spread_cover_probs.items():
            sp = float(sp_str)
            opts.append((sp, cover, f"{home_name} {sp:+.1f} Points"))
            opts.append((-sp, 1.0 - cover, f"{away_name} {-sp:+.1f} Points"))
        _, sp_prob, sp_text = _pick_synthetic(opts)
    candidates.append({"market": BasketballMarket.POINT_SPREAD, "prediction": sp_text,
                       "probability": round(sp_prob, 4), "fair_odds": round(1.0 / max(0.01, sp_prob), 2),
                       "market_odds": 1.90 if spread is not None else None,
                       "edge_pct": round((sp_prob * 1.90 - 1.0) * 100.0, 2) if spread is not None else 0.0,
                       "has_real_odds": spread is not None})

    # Game total
    if total is not None:
        line = round(total * 2) / 2.0
        over = sim.totals_over_probs.get(str(float(line)), 0.5)
        if over >= 0.5:
            tt_text, tt_prob = f"Over {line:.1f} Total Points", over
        else:
            tt_text, tt_prob = f"Under {line:.1f} Total Points", 1.0 - over
    else:
        opts = []
        for tl_str, over in sim.totals_over_probs.items():
            tl = float(tl_str)
            opts.append((tl - p.expected_total, over, f"Over {tl:.1f} Total Points"))
            opts.append((p.expected_total - tl, 1.0 - over, f"Under {tl:.1f} Total Points"))
        _, tt_prob, tt_text = _pick_synthetic(opts)
    candidates.append({"market": BasketballMarket.GAME_TOTAL_OVER_UNDER, "prediction": tt_text,
                       "probability": round(tt_prob, 4), "fair_odds": round(1.0 / max(0.01, tt_prob), 2),
                       "market_odds": 1.90 if total is not None else None,
                       "edge_pct": round((tt_prob * 1.90 - 1.0) * 100.0, 2) if total is not None else 0.0,
                       "has_real_odds": total is not None})

    # Primary = most likely to land; moneyline wins ties.
    order = {BasketballMarket.MONEYLINE: 0, BasketballMarket.POINT_SPREAD: 1, BasketballMarket.GAME_TOTAL_OVER_UNDER: 2}
    candidates.sort(key=lambda c: (-c["probability"], order[c["market"]]))
    primary, secondary = candidates[0], candidates[1:]
    tier = tier_for(primary["probability"], min_prior)

    secondary_list = []
    for c in secondary:
        st = _secondary_tier(c["probability"], min_prior)
        secondary_list.append({"market": c["market"].value, "pick": c["prediction"], "prediction": c["prediction"],
                               "probability": c["probability"], "tier": st, "confidence_category": st})

    cfg = LEAGUE_REGISTRY.get(code)
    notes = (
        f"Ratings model projects {home_name} {p.home_expected:.1f} - {away_name} {p.away_expected:.1f} "
        f"(total {p.expected_total:.1f}, margin {p.expected_margin:+.1f}), learned from {p.home_prior_games} and "
        f"{p.away_prior_games} earlier games. Measured error for this kind of game: margin +/-{margin_sd:.1f}, "
        f"total +/-{total_sd:.1f}. Key recommendation: {primary['prediction']} "
        f"({primary['probability']*100:.1f}% Prob, {tier.value})."
    )
    metadata = {
        "model": MODEL_VERSION,
        "simulation": {
            "simulations_count": sim.simulations_count,
            "expected_pace": cfg.default_pace if cfg else None,
            "simulated_home_score": sim.simulated_home_score,
            "simulated_away_score": sim.simulated_away_score,
            "first_half_score": f"{sim.first_half_home_score} - {sim.first_half_away_score}",
            "distribution_percentiles": sim.percentiles,
            "execution_ms": sim.execution_time_ms,
        },
        "ratings_v2": {
            "home_expected": round(p.home_expected, 2),
            "away_expected": round(p.away_expected, 2),
            "home_prior_games": p.home_prior_games,
            "away_prior_games": p.away_prior_games,
            "league_prior_games": p.league_prior_games,
            "margin_slope": round(slope, 3),
            "calibrated_margin": round(cal_margin, 2),
            "margin_error_sd": round(margin_sd, 2),
            "total_error_sd": round(total_sd, 2),
        },
        "ai_tactical_analysis": notes,
    }
    kickoff = datetime.fromisoformat(fix["target_kickoff_at"].replace("Z", "+00:00"))
    return BasketballPredictionModel(
        id=None, fixture_id=fix["id"], market=primary["market"], prediction=primary["prediction"],
        probability=primary["probability"], confidence_category=tier, secondary_predictions=secondary_list,
        simulations_count=sim.simulations_count, simulated_home_score=sim.simulated_home_score,
        simulated_away_score=sim.simulated_away_score, edge_percentage=primary["edge_pct"],
        fair_odds=primary["fair_odds"], market_odds=primary["market_odds"],
        tier_required="vip" if tier == BasketballConfidenceTier.BANGER else (
            "standard" if tier == BasketballConfidenceTier.TOP_PICK else "free"),
        publication_status="published", target_kickoff_at=kickoff or datetime.now(timezone.utc), metadata=metadata,
    )
