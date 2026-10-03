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
    set_handicap_p1_minus_1_5: float  # P1 wins by >= 1.5 sets (2-0 in Bo3, 3-0/3-1 in Bo5)
    set_handicap_p2_plus_1_5: float   # P2 covers +1.5 sets (wins >= 1 set in Bo3, >= 2 sets in Bo5)
    game_handicaps: Dict[str, float]  # e.g. "-2.5": 0.654, "-3.5": 0.582
    total_games_over: Dict[str, float]  # e.g. "21.5": 0.523, "22.5": 0.441
    correct_scores: Dict[str, float]  # e.g. "2-0": 0.475, "2-1": 0.295
    p1_hold_rate: float
    p2_hold_rate: float
    # Symmetrical set handicaps & parity markets
    set_handicap_p2_minus_1_5: float = 0.0  # P2 wins by >= 1.5 sets
    set_handicap_p1_plus_1_5: float = 0.0   # P1 covers +1.5 sets
    over_2_5_sets_prob: float = 0.0         # Both players win at least 1 set
    p1_game_handicaps: Dict[str, float] = field(default_factory=dict)
    p2_game_handicaps: Dict[str, float] = field(default_factory=dict)


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
        Executes N Monte Carlo match simulations with symmetrical set & game margins.
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
        p2_set_margin_minus_1_5 = 0
        both_players_won_set_count = 0
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

            # Symmetrical Set Handicaps
            if best_of_sets == 3:
                # Bo3: -1.5 Sets is straight sets (2-0 vs 0-2)
                p1_set_margin_minus_1_5 += np.count_nonzero((p1_sets == 2) & (p2_sets == 0))
                p2_set_margin_minus_1_5 += np.count_nonzero((p2_sets == 2) & (p1_sets == 0))
                both_players_won_set_count += np.count_nonzero((p1_sets >= 1) & (p2_sets >= 1))
            else:
                # Bo5 (Grand Slam): -1.5 Sets is winning 3-0 or 3-1 (losing <= 1 set)
                p1_set_margin_minus_1_5 += np.count_nonzero((p1_sets == 3) & (p2_sets <= 1))
                p2_set_margin_minus_1_5 += np.count_nonzero((p2_sets == 3) & (p1_sets <= 1))
                both_players_won_set_count += np.count_nonzero((p1_sets >= 1) & (p2_sets >= 1))

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

        # Symmetrical Game Handicaps for both players (-0.5 to -9.5 and +0.5 to +9.5)
        p1_margins = game_margins_list
        p2_margins = -game_margins_list
        hcap_lines = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5]

        p1_game_handicaps: Dict[str, float] = {}
        p2_game_handicaps: Dict[str, float] = {}
        for h in hcap_lines:
            prob_p1_minus = round(float(np.mean(p1_margins > h)), 4)
            prob_p2_minus = round(float(np.mean(p2_margins > h)), 4)

            # Player 1 handicaps: -h covers if p1_margin > h; +h covers if p1_margin > -h (1 - p2_margin > h)
            p1_game_handicaps[f"-{h}"] = prob_p1_minus
            p1_game_handicaps[f"+{h}"] = round(1.0 - prob_p2_minus, 4)

            # Player 2 handicaps: -h covers if p2_margin > h; +h covers if p2_margin > -h (1 - p1_margin > h)
            p2_game_handicaps[f"-{h}"] = prob_p2_minus
            p2_game_handicaps[f"+{h}"] = round(1.0 - prob_p1_minus, 4)

        # Total Games Over/Under across entire spectrum (Bo3: 16.5-28.5, Bo5: 29.5-48.5)
        total_game_lines = [
            16.5, 17.5, 18.5, 19.5, 20.5, 21.5, 22.5, 23.5, 24.5, 25.5, 26.5, 27.5, 28.5,
            29.5, 30.5, 31.5, 32.5, 33.5, 34.5, 35.5, 36.5, 37.5, 38.5, 39.5, 40.5, 41.5,
            42.5, 43.5, 44.5, 45.5, 46.5, 47.5, 48.5
        ]
        total_games_over = {}
        for line in total_game_lines:
            prob_over = round(float(np.mean(total_games_list > line)), 4)
            total_games_over[str(line)] = prob_over

        # Symmetrical Set Handicaps
        set_hcap_p1_minus15 = round(p1_set_margin_minus_1_5 / n, 4)
        set_hcap_p2_plus15 = round(1.0 - set_hcap_p1_minus15, 4)
        set_hcap_p2_minus15 = round(p2_set_margin_minus_1_5 / n, 4)
        set_hcap_p1_plus15 = round(1.0 - set_hcap_p2_minus15, 4)
        over_2_5_sets = round(both_players_won_set_count / n, 4)

        correct_scores = {k: round(v / n, 4) for k, v in correct_score_counts.items()}

        return SimulationResults(
            simulations_count=n,
            p1_win_prob=p1_win_prob,
            p2_win_prob=p2_win_prob,
            first_set_p1_prob=first_set_p1,
            first_set_p2_prob=first_set_p2,
            expected_total_games=exp_games,
            expected_game_margin=exp_margin,
            set_handicap_p1_minus_1_5=set_hcap_p1_minus15,
            set_handicap_p2_plus_1_5=set_hcap_p2_plus15,
            game_handicaps=p1_game_handicaps,
            total_games_over=total_games_over,
            correct_scores=correct_scores,
            p1_hold_rate=round(p1_hold, 4),
            p2_hold_rate=round(p2_hold, 4),
            set_handicap_p2_minus_1_5=set_hcap_p2_minus15,
            set_handicap_p1_plus_1_5=set_hcap_p1_plus15,
            over_2_5_sets_prob=over_2_5_sets,
            p1_game_handicaps=p1_game_handicaps,
            p2_game_handicaps=p2_game_handicaps
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
