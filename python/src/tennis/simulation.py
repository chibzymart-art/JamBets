"""
Oddsbanta — High-Performance Tennis Monte Carlo Simulation Engine
Phase 3: Hierarchical Markov-Chain & Monte Carlo Simulation Engine

Simulates 250,000 match instances to derive joint probability distributions for:
1. Match Winner
2. Game Handicaps (-1.5, -2.5, -3.5, -4.5, -5.5)
3. Total Games Over/Under (19.5, 20.5, 21.5, 22.5, 23.5, 24.5)
4. Set Handicaps (-1.5 Sets vs +1.5 Sets)
5. First Set Winner
6. Exact Set Scores (2-0, 2-1, 0-2, 1-2)

Invariant: 100% isolated tennis stochastic engine. Zero football cross-contamination.
"""

import numpy as np
from dataclasses import dataclass, field
from typing import Dict, Any, List, Tuple
from .markov import TennisMarkovModel


@dataclass
class SimulationResults:
    simulations_count: int
    p1_win_prob: float
    p2_win_prob: float
    first_set_p1_prob: float
    first_set_p2_prob: float
    expected_total_games: float
    expected_game_margin: float
    set_handicap_p1_minus_1_5: float  # P1 wins in straight sets (2-0)
    set_handicap_p2_plus_1_5: float   # P2 wins at least 1 set
    game_handicaps: Dict[str, float]  # e.g. "-2.5": 0.654, "-3.5": 0.582
    total_games_over: Dict[str, float]  # e.g. "21.5": 0.523, "22.5": 0.441
    correct_scores: Dict[str, float]  # e.g. "2-0": 0.475, "2-1": 0.295
    p1_hold_rate: float
    p2_hold_rate: float


class TennisMonteCarloSimulator:
    """
    Simulates tennis matches using Markov game/tiebreak parameters.
    """

    def __init__(self, default_simulations: int = 250000):
        self.default_sims = default_simulations

    def simulate_match(
        self,
        p1_serve_pt: float,
        p2_serve_pt: float,
        best_of_sets: int = 3,
        num_simulations: int = 250000
    ) -> SimulationResults:
        """
        Executes N Monte Carlo match simulations.
        """
        # Analytical game and tiebreak transition probabilities
        p1_hold = TennisMarkovModel.game_hold_probability(p1_serve_pt)
        p2_hold = TennisMarkovModel.game_hold_probability(p2_serve_pt)
        p1_tb_win = TennisMarkovModel.tiebreak_win_probability(p1_serve_pt, p2_serve_pt, first_server=1)

        # Batch vector simulation
        n = num_simulations
        sets_needed = 2 if best_of_sets == 3 else 3

        # Match trackers
        p1_match_wins = 0
        p1_first_set_wins = 0
        p1_set_margin_minus_1_5 = 0
        total_games_list = np.zeros(n, dtype=np.int32)
        game_margins_list = np.zeros(n, dtype=np.int32)
        correct_score_counts: Dict[str, int] = {}

        # Run vector simulations in chunks for optimal memory/cache locality
        chunk_size = 50000
        total_processed = 0

        while total_processed < n:
            curr_chunk = min(chunk_size, n - total_processed)

            # Simulate sets for chunk
            p1_sets = np.zeros(curr_chunk, dtype=np.int32)
            p2_sets = np.zeros(curr_chunk, dtype=np.int32)
            chunk_p1_games = np.zeros(curr_chunk, dtype=np.int32)
            chunk_p2_games = np.zeros(curr_chunk, dtype=np.int32)

            # Simulate up to max possible sets (3 for bo3, 5 for bo5)
            max_sets = 3 if best_of_sets == 3 else 5
            for set_idx in range(max_sets):
                active = (p1_sets < sets_needed) & (p2_sets < sets_needed)
                active_count = np.count_nonzero(active)
                if active_count == 0:
                    break

                # Simulate a tennis set for active matches
                set_p1_g, set_p2_g, set_p1_won = self._simulate_set_vector(
                    count=active_count,
                    p1_hold=p1_hold,
                    p2_hold=p2_hold,
                    p1_tb_win=p1_tb_win
                )

                chunk_p1_games[active] += set_p1_g
                chunk_p2_games[active] += set_p2_g

                # Record first set
                if set_idx == 0:
                    # In first set, all matches in chunk are active
                    p1_first_set_wins += np.count_nonzero(set_p1_won)

                p1_sets[active] += set_p1_won.astype(np.int32)
                p2_sets[active] += (1 - set_p1_won.astype(np.int32))

            # Tally chunk statistics
            p1_won_match = p1_sets == sets_needed
            p1_match_wins += np.count_nonzero(p1_won_match)

            # Set handicap -1.5 (P1 wins in straight sets, e.g. 2-0 in bo3, 3-0/3-1 in bo5)
            if best_of_sets == 3:
                p1_set_margin_minus_1_5 += np.count_nonzero((p1_sets == 2) & (p2_sets == 0))
            else:
                p1_set_margin_minus_1_5 += np.count_nonzero((p1_sets == 3) & (p2_sets <= 1))

            start_idx = total_processed
            end_idx = total_processed + curr_chunk
            total_games_list[start_idx:end_idx] = chunk_p1_games + chunk_p2_games
            game_margins_list[start_idx:end_idx] = chunk_p1_games - chunk_p2_games

            # Count scorelines
            for s1, s2 in zip(p1_sets, p2_sets):
                sc = f"{s1}-{s2}"
                correct_score_counts[sc] = correct_score_counts.get(sc, 0) + 1

            total_processed += curr_chunk

        # Empirical Probabilities
        p1_win_prob = round(p1_match_wins / n, 4)
        p2_win_prob = round(1.0 - p1_win_prob, 4)
        first_set_p1 = round(p1_first_set_wins / n, 4)
        first_set_p2 = round(1.0 - first_set_p1, 4)
        exp_games = round(float(np.mean(total_games_list)), 1)
        exp_margin = round(float(np.mean(game_margins_list)), 1)

        # Game Handicaps (-1.5 to -5.5)
        game_handicaps = {}
        for h in [1.5, 2.5, 3.5, 4.5, 5.5]:
            prob_cover = round(float(np.mean(game_margins_list > h)), 4)
            game_handicaps[f"-{h}"] = prob_cover
            game_handicaps[f"+{h}"] = round(1.0 - prob_cover, 4)

        # Total Games Over/Under (Lines 19.5 through 25.5)
        total_games_over = {}
        for line in [19.5, 20.5, 21.5, 22.5, 23.5, 24.5, 25.5]:
            prob_over = round(float(np.mean(total_games_list > line)), 4)
            total_games_over[str(line)] = prob_over

        set_hcap_minus15 = round(p1_set_margin_minus_1_5 / n, 4)
        set_hcap_plus15 = round(1.0 - set_hcap_minus15, 4)

        correct_scores = {k: round(v / n, 4) for k, v in correct_score_counts.items()}

        return SimulationResults(
            simulations_count=n,
            p1_win_prob=p1_win_prob,
            p2_win_prob=p2_win_prob,
            first_set_p1_prob=first_set_p1,
            first_set_p2_prob=first_set_p2,
            expected_total_games=exp_games,
            expected_game_margin=exp_margin,
            set_handicap_p1_minus_1_5=set_hcap_minus15,
            set_handicap_p2_plus_1_5=set_hcap_plus15,
            game_handicaps=game_handicaps,
            total_games_over=total_games_over,
            correct_scores=correct_scores,
            p1_hold_rate=round(p1_hold, 4),
            p2_hold_rate=round(p2_hold, 4)
        )

    def _simulate_set_vector(
        self,
        count: int,
        p1_hold: float,
        p2_hold: float,
        p1_tb_win: float
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Fast simulation of 'count' sets.
        Simulates game outcomes up to set conclusion (6-0 to 7-6).
        """
        g1 = np.zeros(count, dtype=np.int32)
        g2 = np.zeros(count, dtype=np.int32)
        active = np.ones(count, dtype=bool)

        # Max 12 regular games before tiebreak
        for game_num in range(12):
            if not np.any(active):
                break

            # Server: P1 serves even games, P2 serves odd games
            p1_serving = (game_num % 2 == 0)
            p1_win_game_prob = p1_hold if p1_serving else (1.0 - p2_hold)

            # Roll game winner
            rand_vals = np.random.random(count)
            p1_won_game = rand_vals < p1_win_game_prob

            g1[active] += p1_won_game[active].astype(np.int32)
            g2[active] += (~p1_won_game[active]).astype(np.int32)

            # Check if set is won before 6-6
            # A set is won if a player reaches >= 6 games with >= 2 margin
            set_won_p1 = (g1 >= 6) & (g1 - g2 >= 2)
            set_won_p2 = (g2 >= 6) & (g2 - g1 >= 2)
            active = active & ~(set_won_p1 | set_won_p2)

        # Handle matches that reached 6-6 tiebreak
        reached_tb = (g1 == 6) & (g2 == 6)
        if np.any(reached_tb):
            tb_rand = np.random.random(count)
            p1_won_tb = tb_rand < p1_tb_win

            g1[reached_tb & p1_won_tb] += 1  # 7-6
            g2[reached_tb & ~p1_won_tb] += 1  # 6-7

        p1_won_set = g1 > g2
        return g1, g2, p1_won_set
