"""
Oddsbanta — Autonomous Tennis Settlement & Audit Engine
Phase 4: Autonomous Settlement & Audit Daemon

Evaluates match results against tennis rules:
1. Full Match Completion:
   - Match Winner
   - Set Handicap (-1.5 Sets / +1.5 Sets)
   - Game Handicap (-2.5, -3.5, +2.5, +3.5, etc.)
   - Total Games Over / Under (Lines 19.5 to 25.5)
   - First Set Winner
2. Official Tennis Edge-Case Rules:
   - Retirements (RET): 1-Set Rule applied to match winner; unreached total games & handicaps voided.
   - Walkovers (WO): 100% voided across all markets.
3. Persistence:
   - Updates public.tennis_predictions status and actual_result.
   - Generates immutable audit logs in public.tennis_settlements.

Invariant: 100% isolated tennis settlement system. Zero football touchpoints.
"""

import re
import sys
import logging
import argparse
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime, timezone, timedelta

from .db import TennisDbClient
from .scraper.espn_feed import EspnTennisFeedScraper, TennisFixtureMatcher

logger = logging.getLogger("tennis.settlement")


class TennisSettlementEngine:
    """
    Dedicated settlement engine for tennis predictions and audit trail generation.
    """

    def __init__(self, db_client: Optional[TennisDbClient] = None):
        self.db = db_client or TennisDbClient()

    @staticmethod
    def parse_total_games(set_scores: List[str]) -> Tuple[int, int, int]:
        """
        Parses array of set score strings (e.g. ['6-4', '3-6', '7-6'])
        Returns (p1_games, p2_games, total_games).
        """
        p1_g = 0
        p2_g = 0
        for s in set_scores:
            # Strip tiebreak scores if present, e.g. 7-6(5) -> 7-6
            clean = re.sub(r"\(\d+\)", "", s.strip())
            parts = clean.split("-")
            if len(parts) == 2:
                try:
                    p1_g += int(parts[0])
                    p2_g += int(parts[1])
                except ValueError:
                    continue
        return p1_g, p2_g, p1_g + p2_g

    @classmethod
    def evaluate_prediction(
        cls,
        market: str,
        prediction_text: str,
        fixture: Dict[str, Any]
    ) -> Tuple[str, str, str]:
        """
        Evaluates a prediction against completed fixture outcome.
        Returns: (settlement_status, notes, actual_result_summary)
        """
        status = fixture.get("status", "scheduled")
        p1 = fixture.get("player1") or {}
        p2 = fixture.get("player2") or {}
        p1_name = p1.get("display_name", "Player 1")
        p2_name = p2.get("display_name", "Player 2")
        winner_id = fixture.get("winner_id")
        retired_id = fixture.get("retired_player_id")

        p1_sets = int(fixture.get("score_p1_sets") or 0)
        p2_sets = int(fixture.get("score_p2_sets") or 0)
        set_scores = fixture.get("set_scores") or []
        p1_games, p2_games, total_games = cls.parse_total_games(set_scores)

        scoreline = ", ".join(set_scores) if set_scores else f"{p1_sets}-{p2_sets}"

        # -----------------------------------------------------------------
        # 1. WALKOVER RULE (WO)
        # -----------------------------------------------------------------
        if status == "walkover":
            actual_res = f"Walkover (Match unplayed)"
            notes = "Match conceded prior to commencement. All betting markets voided per ATP/WTA rules."
            return "void", notes, actual_res

        # -----------------------------------------------------------------
        # 2. RETIREMENT RULE (RET)
        # -----------------------------------------------------------------
        if status == "retired":
            ret_name = p1_name if retired_id == fixture.get("player1_id") else p2_name
            adv_name = p2_name if retired_id == fixture.get("player1_id") else p1_name
            actual_res = f"{adv_name} advanced ({ret_name} retired at {scoreline})"

            # Completed sets check
            completed_sets = 0
            for s in set_scores:
                clean = re.sub(r"\(\d+\)", "", s.strip())
                parts = clean.split("-")
                if len(parts) == 2:
                    try:
                        s1, s2 = int(parts[0]), int(parts[1])
                        if (s1 >= 6 and s1 - s2 >= 2) or (s2 >= 6 and s2 - s1 >= 2) or (s1 == 7 and s2 == 6) or (s2 == 7 and s1 == 6):
                            completed_sets += 1
                    except ValueError:
                        pass

            # Market Winner under 1-set retirement rule:
            if market == "match_winner":
                if completed_sets >= 1:
                    adv_won = (winner_id == fixture.get("player1_id") and p1_name in prediction_text) or \
                              (winner_id == fixture.get("player2_id") and p2_name in prediction_text)
                    if adv_won:
                        return "won", f"Advancing player ({adv_name}) awarded victory under 1-set retirement rule.", actual_res
                    else:
                        return "lost", f"Predicted player retired or lost match under 1-set retirement rule.", actual_res
                else:
                    return "void", f"Retirement occurred in Set 1 before completion. Match winner market voided.", actual_res

            # Total games & Handicaps on retirement:
            if market == "total_games_over_under":
                match_line = re.search(r"(\d+\.?\d*)", prediction_text)
                if match_line:
                    line = float(match_line.group(1))
                    if "Over" in prediction_text and total_games > line:
                        return "won", f"Over {line} exceeded prior to retirement ({total_games} games played).", actual_res
                    elif "Under" in prediction_text and total_games > line:
                        return "lost", f"Under {line} line breached prior to retirement ({total_games} games played).", actual_res
                return "void", "Match unfinished due to retirement; unreached total games line voided.", actual_res

            # Set/Game handicaps voided on retirement
            return "void", "Handicap market voided due to incomplete retirement match.", actual_res

        # -----------------------------------------------------------------
        # 3. FULL MATCH COMPLETION (FINISHED)
        # -----------------------------------------------------------------
        winner_name = p1_name if winner_id == fixture.get("player1_id") else p2_name
        loser_name = p2_name if winner_id == fixture.get("player1_id") else p1_name
        winner_sets = max(p1_sets, p2_sets)
        loser_sets = min(p1_sets, p2_sets)
        actual_res = f"{winner_name} won {winner_sets}-{loser_sets} ({scoreline})"

        # A. NO SAFE BANKER
        if market == "NO_SAFE_BANKER":
            return "void", "Advisory pick marked as NO_SAFE_BANKER; resolved as non-wagering void.", actual_res

        # B. MATCH WINNER
        if market == "match_winner":
            p1_predicted = p1_name.lower() in prediction_text.lower() or "player 1" in prediction_text.lower()
            p2_predicted = p2_name.lower() in prediction_text.lower() or "player 2" in prediction_text.lower()

            if p1_predicted and winner_id == fixture.get("player1_id"):
                return "won", f"{p1_name} won match in full ({scoreline}).", actual_res
            elif p2_predicted and winner_id == fixture.get("player2_id"):
                return "won", f"{p2_name} won match in full ({scoreline}).", actual_res
            else:
                return "lost", f"{loser_name} defeated by {winner_name} ({scoreline}).", actual_res

        # C. SET HANDICAP (-1.5 / +1.5)
        if market == "set_handicap":
            if "-1.5" in prediction_text:
                fav_p1 = p1_name.lower() in prediction_text.lower()
                fav_sets = p1_sets if fav_p1 else p2_sets
                dog_sets = p2_sets if fav_p1 else p1_sets
                if fav_sets - dog_sets > 1.5:  # e.g. 2-0 (diff 2) or 3-0 / 3-1
                    return "won", f"Favorite covered -1.5 sets margin ({fav_sets}-{dog_sets}).", actual_res
                else:
                    return "lost", f"Favorite failed to cover -1.5 sets margin ({fav_sets}-{dog_sets}).", actual_res
            elif "+1.5" in prediction_text:
                dog_p1 = p1_name.lower() in prediction_text.lower()
                dog_sets = p1_sets if dog_p1 else p2_sets
                if dog_sets >= 1:
                    return "won", f"Underdog won at least 1 set (+1.5 covered).", actual_res
                else:
                    return "lost", f"Underdog failed to win a set (lost in straight sets).", actual_res

        # D. GAME HANDICAP
        if market == "game_handicap":
            hcap_match = re.search(r"([+-]?\d+\.?\d*)", prediction_text)
            if hcap_match:
                hcap = float(hcap_match.group(1))
                is_p1_handicap = p1_name.lower() in prediction_text.lower()
                net_margin = (p1_games - p2_games) if is_p1_handicap else (p2_games - p1_games)
                if net_margin + hcap > 0:
                    return "won", f"Game handicap {hcap:+} covered with net margin {net_margin:+}.", actual_res
                elif net_margin + hcap < 0:
                    return "lost", f"Game handicap {hcap:+} failed with net margin {net_margin:+}.", actual_res
                else:
                    return "void", f"Push on game handicap {hcap:+}.", actual_res

        # E. TOTAL GAMES OVER / UNDER
        if market == "total_games_over_under":
            line_match = re.search(r"(\d+\.?\d*)", prediction_text)
            if line_match:
                line = float(line_match.group(1))
                if "Over" in prediction_text:
                    if total_games > line:
                        return "won", f"Total games ({total_games}) exceeded Over {line}.", actual_res
                    else:
                        return "lost", f"Total games ({total_games}) fell short of Over {line}.", actual_res
                elif "Under" in prediction_text:
                    if total_games < line:
                        return "won", f"Total games ({total_games}) stayed Under {line}.", actual_res
                    else:
                        return "lost", f"Total games ({total_games}) exceeded Under {line}.", actual_res

        # F. FIRST SET WINNER
        if market == "first_set_winner":
            if set_scores:
                clean_s1 = re.sub(r"\(\d+\)", "", set_scores[0].strip()).split("-")
                if len(clean_s1) == 2:
                    s1_g1, s1_g2 = int(clean_s1[0]), int(clean_s1[1])
                    s1_p1_won = s1_g1 > s1_g2
                    predicted_p1 = p1_name.lower() in prediction_text.lower()
                    if (predicted_p1 and s1_p1_won) or (not predicted_p1 and not s1_p1_won):
                        return "won", f"First set won ({set_scores[0]}).", actual_res
                    else:
                        return "lost", f"First set lost ({set_scores[0]}).", actual_res

        # Fallback default
        return "void", "Unsettled or unknown market configuration.", actual_res

    def run_precision_settlement_cycle(
        self,
        lookback_hours: int = 48,
        lookahead_minutes: int = 30,
        scraper: Optional[EspnTennisFeedScraper] = None,
        dry_run: bool = False
    ) -> Dict[str, Any]:
        """
        Autonomous Precision Tennis Settlement Engine.
        Scrapes and settles ONLY current fixtures within [now - lookback_hours, now + lookahead_minutes].
        Guarantees:
        1. Never scrapes or settles old historical fixtures from past weeks or months.
        2. Uses multi-factor precision matcher (Exact ESPN competition ID + Date/Time Proximity + Player Canonical slugs + Tournament).
        3. Updates live in-play states in tennis_fixtures.
        4. Accurately evaluates completed/retired/walkover match outcomes against all betting rules.
        5. Atomically persists settlement statuses in tennis_predictions and immutable audit entries in tennis_settlements.
        """
        stats = {
            "inspected": 0,
            "matched": 0,
            "live_updated": 0,
            "settled": 0,
            "won": 0,
            "lost": 0,
            "void": 0,
            "unsettled_pending": 0
        }

        now_utc = datetime.now(timezone.utc)
        min_kickoff = (now_utc - timedelta(hours=lookback_hours)).isoformat()
        max_kickoff = (now_utc + timedelta(minutes=lookahead_minutes)).isoformat()

        logger.info(
            "Starting Precision Tennis Settlement Cycle for current active window: %s to %s (Lookback: %dh)",
            min_kickoff, max_kickoff, lookback_hours
        )

        # 1. Fetch pending predictions within current kickoff window
        try:
            resp = self.db.client.get(
                "/tennis_predictions",
                params={
                    "settlement_status": "eq.pending",
                    "target_kickoff_at": f"gte.{min_kickoff}",
                    "and": f"(target_kickoff_at.lte.{max_kickoff})",
                    "select": "id,fixture_id,market,prediction,target_kickoff_at,fixture:tennis_fixtures(*,tournament:tennis_tournaments(*),player1:tennis_players!tennis_fixtures_player1_id_fkey(*),player2:tennis_players!tennis_fixtures_player2_id_fkey(*))",
                    "order": "target_kickoff_at.asc"
                }
            )
            resp.raise_for_status()
            pending_items = resp.json()
        except Exception as e:
            logger.error("Failed to query pending tennis predictions: %s", e, exc_info=True)
            return stats

        stats["inspected"] = len(pending_items)
        if not pending_items:
            logger.info("Zero pending tennis predictions found in current settlement window.")
            return stats

        logger.info("Auditing %d pending predictions for current fixtures...", len(pending_items))

        # 2. Extract distinct target dates (YYYYMMDD) and tours (ATP / WTA)
        target_dates = set()
        tours = set()
        for item in pending_items:
            fix = item.get("fixture") or {}
            k = item.get("target_kickoff_at") or fix.get("target_kickoff_at")
            if k:
                target_dates.add(k[:10].replace("-", ""))
            tour_val = (fix.get("tournament") or {}).get("tour") or ""
            if not tour_val and fix.get("canonical_key"):
                tour_val = fix["canonical_key"].split(":")[0]
            if tour_val.upper() in ("ATP", "GRAND_SLAM", "CHALLENGER"):
                tours.add("atp")
            elif tour_val.upper() in ("WTA", "ITF"):
                tours.add("wta")
            else:
                tours.add("atp")
                tours.add("wta")

        # Always include today and yesterday as active tournament days
        target_dates.add(now_utc.strftime("%Y%m%d"))
        target_dates.add((now_utc - timedelta(days=1)).strftime("%Y%m%d"))
        target_tours = list(tours) if tours else ["atp", "wta"]

        logger.info(
            "Scraping ESPN scoreboards across %d dates %s for tours %s",
            len(target_dates), sorted(target_dates), target_tours
        )

        # 3. Scrape ESPN scoreboards for these target dates
        feed_scraper = scraper or EspnTennisFeedScraper()
        espn_comps: List[Dict[str, Any]] = []

        for d in sorted(target_dates):
            for tour in target_tours:
                try:
                    raw_data = feed_scraper.fetch_scoreboard(tour=tour, date_str=d)
                    if raw_data:
                        comps = feed_scraper.parse_settlement_results_from_scoreboard(raw_data, tour=tour)
                        espn_comps.extend(comps)
                except Exception as e:
                    logger.warning("Error fetching ESPN %s scoreboard for %s: %s", tour.upper(), d, e)

        logger.info("Acquired %d singles competitions from ESPN live feed for matching.", len(espn_comps))

        # 4. Precision Match & Settle
        for item in pending_items:
            pred_id = item["id"]
            fixture_id = item["fixture_id"]
            market = item["market"]
            prediction_text = item["prediction"]
            fix = item.get("fixture")

            if not fix:
                continue

            # Check if fixture was already marked finished/retired/walkover in Supabase
            if fix.get("status") in ("finished", "retired", "walkover"):
                settlement_status, notes, actual_result = self.evaluate_prediction(
                    market=market,
                    prediction_text=prediction_text,
                    fixture=fix
                )
                p1_sets = int(fix.get("score_p1_sets") or 0)
                p2_sets = int(fix.get("score_p2_sets") or 0)
                _, _, total_games = self.parse_total_games(fix.get("set_scores") or [])

                if not dry_run:
                    try:
                        self.db.settle_prediction(
                            prediction_id=pred_id,
                            fixture_id=fixture_id,
                            status=settlement_status,
                            notes=notes,
                            p1_sets=p1_sets,
                            p2_sets=p2_sets,
                            total_games=total_games,
                            was_retired=(fix.get("status") == "retired"),
                            was_walkover=(fix.get("status") == "walkover"),
                            actual_result=actual_result
                        )
                        stats["settled"] += 1
                        if settlement_status == "won":
                            stats["won"] += 1
                        elif settlement_status == "lost":
                            stats["lost"] += 1
                        elif settlement_status == "void":
                            stats["void"] += 1
                        logger.info("Settled existing finished fixture prediction %s -> %s (%s)", pred_id, settlement_status.upper(), actual_result)
                    except Exception as e:
                        logger.error("Failed settling fixture %s: %s", fixture_id, e)
                continue

            # Find matching live/completed ESPN competition
            matched_comp = None
            for c in espn_comps:
                if TennisFixtureMatcher.match(fix, c):
                    matched_comp = c
                    break

            if not matched_comp:
                stats["unsettled_pending"] += 1
                logger.debug("Fixture %s (%s) has no matching live/completed score yet.", fixture_id, fix.get("canonical_key"))
                continue

            stats["matched"] += 1
            aligned = TennisFixtureMatcher.align_scores(fix, matched_comp)
            comp_status = aligned["status"]

            # Handle LIVE match in-play state
            if comp_status == "live":
                stats["live_updated"] += 1
                if not dry_run:
                    try:
                        self.db.update_fixture_score(fixture_id, {
                            "status": "live",
                            "score_p1_sets": aligned["score_p1_sets"],
                            "score_p2_sets": aligned["score_p2_sets"],
                            "set_scores": aligned["set_scores"]
                        })
                        logger.info("Updated live in-play fixture %s (%s): %d-%d Sets", fixture_id, fix.get("canonical_key"), aligned["score_p1_sets"], aligned["score_p2_sets"])
                    except Exception as e:
                        logger.warning("Failed to update live fixture %s: %s", fixture_id, e)
                continue

            # Handle COMPLETED matches (finished, retired, walkover)
            if comp_status in ("finished", "retired", "walkover"):
                fixture_updates = {
                    "status": comp_status,
                    "score_p1_sets": aligned["score_p1_sets"],
                    "score_p2_sets": aligned["score_p2_sets"],
                    "set_scores": aligned["set_scores"],
                    "winner_id": aligned["winner_id"],
                    "retired_player_id": aligned["retired_player_id"]
                }
                meta = fix.get("metadata") or {}
                if aligned.get("espn_competition_id"):
                    meta["espn_competition_id"] = aligned["espn_competition_id"]
                meta["was_retired"] = aligned["was_retired"]
                meta["was_walkover"] = aligned["was_walkover"]
                meta["settlement_synced_at"] = now_utc.isoformat()
                fixture_updates["metadata"] = meta

                if not dry_run:
                    try:
                        self.db.update_fixture_score(fixture_id, fixture_updates)
                    except Exception as e:
                        logger.error("Failed to update completed fixture %s: %s", fixture_id, e)

                eval_fixture = dict(fix)
                eval_fixture.update(fixture_updates)

                settlement_status, notes, actual_result = self.evaluate_prediction(
                    market=market,
                    prediction_text=prediction_text,
                    fixture=eval_fixture
                )

                p1_sets = aligned["score_p1_sets"]
                p2_sets = aligned["score_p2_sets"]
                _, _, total_games = self.parse_total_games(aligned["set_scores"])

                if not dry_run:
                    try:
                        self.db.settle_prediction(
                            prediction_id=pred_id,
                            fixture_id=fixture_id,
                            status=settlement_status,
                            notes=notes,
                            p1_sets=p1_sets,
                            p2_sets=p2_sets,
                            total_games=total_games,
                            was_retired=aligned["was_retired"],
                            was_walkover=aligned["was_walkover"],
                            actual_result=actual_result
                        )
                        stats["settled"] += 1
                        if settlement_status == "won":
                            stats["won"] += 1
                        elif settlement_status == "lost":
                            stats["lost"] += 1
                        elif settlement_status == "void":
                            stats["void"] += 1
                        logger.info("Settled prediction %s -> %s (%s)", pred_id, settlement_status.upper(), actual_result)
                    except Exception as e:
                        logger.error("Failed to settle prediction %s: %s", pred_id, e, exc_info=True)
                else:
                    stats["settled"] += 1
                    logger.info("[DRY RUN] Would settle %s -> %s (%s)", pred_id, settlement_status.upper(), actual_result)
            else:
                stats["unsettled_pending"] += 1

        logger.info("Precision Tennis Settlement cycle complete: %s", stats)
        return stats

    def run_settlement_cycle(self) -> Dict[str, int]:
        """
        Backward-compatible settlement entrypoint used by daemon.
        Defaults to precision 48-hour active settlement cycle.
        """
        res = self.run_precision_settlement_cycle(lookback_hours=48)
        return {
            "checked": res.get("inspected", 0),
            "settled": res.get("settled", 0),
            "won": res.get("won", 0),
            "lost": res.get("lost", 0),
            "void": res.get("void", 0)
        }


def main():
    parser = argparse.ArgumentParser(description="Oddsbanta Autonomous Tennis Precision Settlement Daemon")
    parser.add_argument("--lookback-hours", type=int, default=48, help="Lookback window in hours (default: 48)")
    parser.add_argument("--dry-run", action="store_true", help="Inspect and evaluate without mutating database")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] [TENNIS-SETTLEMENT] %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)]
    )

    logger.info("Starting Autonomous Tennis Precision Settlement Engine...")
    engine = TennisSettlementEngine()
    stats = engine.run_precision_settlement_cycle(lookback_hours=args.lookback_hours, dry_run=args.dry_run)
    logger.info("Execution complete: %s", stats)


if __name__ == "__main__":
    main()
