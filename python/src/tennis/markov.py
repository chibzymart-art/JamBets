"""
Oddsbanta — Analytical Tennis Markov Chain Engine
Phase 3: Hierarchical Markov-Chain & Monte Carlo Simulation Engine

Provides closed-form and exact dynamic programming solutions for:
1. Game hold/break probabilities from single point serve percentages
2. 7-point tiebreak transition matrix with alternating service
3. Set outcome distributions (6-0 through 7-6)
4. Match probabilities for Best-of-3 and Best-of-5 structures

Invariant: Pure mathematical tennis probability engine. Zero dependencies on football code.
"""

import math
from typing import Dict, Any, Tuple


class TennisMarkovModel:
    """
    Exact analytical Markov chain calculator for tennis scoring hierarchies.
    """

    @staticmethod
    def game_hold_probability(p_serve_pt: float) -> float:
        """
        Calculates exact probability of a server winning a game given single-point win probability p.
        Formula derived from absorbing Markov chain with infinite deuce transitions:
        P(Hold) = p^4 + 4*p^4*(1-p) + 10*p^4*(1-p)^2 + 20*p^3*(1-p)^3 * [p^2 / (p^2 + (1-p)^2)]
        """
        p = max(0.01, min(0.99, p_serve_pt))
        q = 1.0 - p

        # Pre-deuce terminal states
        p_love = math.pow(p, 4)
        p_15 = 4.0 * math.pow(p, 4) * q
        p_30 = 10.0 * math.pow(p, 4) * math.pow(q, 2)

        # Deuce reach probability (3 points each)
        p_reach_deuce = 20.0 * math.pow(p, 3) * math.pow(q, 3)

        # Absorbing probability of winning from deuce
        p_win_from_deuce = math.pow(p, 2) / (math.pow(p, 2) + math.pow(q, 2))

        p_hold = p_love + p_15 + p_30 + (p_reach_deuce * p_win_from_deuce)
        return max(0.0, min(1.0, p_hold))

    @classmethod
    def tiebreak_win_probability(cls, p1_serve_pt: float, p2_serve_pt: float, first_server: int = 1) -> float:
        """
        Exact dynamic programming calculation of a 7-point tiebreak with service alternation:
        Point 1: Server A
        Points 2-3: Server B
        Points 4-5: Server A
        ...
        At 6-6: Each player serves 1 point sequentially until 2-point margin is reached.
        """
        p1 = max(0.01, min(0.99, p1_serve_pt))
        p2 = max(0.01, min(0.99, p2_serve_pt))
        q1 = 1.0 - p1
        q2 = 1.0 - p2

        # DP State table: dp[i][j] = prob P1 reaches (i, j)
        # We need probabilities up to 6-6 and winning at 7-x
        dp = {}
        dp[(0, 0)] = 1.0

        p1_wins_tiebreak = 0.0

        for total_pts in range(0, 12):
            for i in range(total_pts + 1):
                j = total_pts - i
                if (i, j) not in dp:
                    continue

                prob_state = dp[(i, j)]
                if prob_state <= 0.0:
                    continue

                # Determine who serves point total_pts + 1
                # Standard order: P1 serves pt 0; P2 serves pts 1,2; P1 serves pts 3,4; etc.
                if total_pts == 0:
                    curr_server = first_server
                else:
                    cycle = (total_pts + 1) // 2
                    if cycle % 2 == 1:
                        curr_server = 2 if first_server == 1 else 1
                    else:
                        curr_server = 1 if first_server == 1 else 2

                # P1 wins point with prob:
                p1_pt_win = p1 if curr_server == 1 else q2

                # Transition to (i + 1, j)
                if i + 1 >= 7 and (i + 1) - j >= 2:
                    p1_wins_tiebreak += prob_state * p1_pt_win
                else:
                    dp[(i + 1, j)] = dp.get((i + 1, j), 0.0) + prob_state * p1_pt_win

                # Transition to (i, j + 1)
                p2_pt_win = 1.0 - p1_pt_win
                if j + 1 >= 7 and (j + 1) - i >= 2:
                    pass  # P2 wins tiebreak
                else:
                    dp[(i, j + 1)] = dp.get((i, j + 1), 0.0) + prob_state * p2_pt_win

        # Resolution from 6-6 tiebreak deuce
        prob_6_6 = dp.get((6, 6), 0.0)
        if prob_6_6 > 0.0:
            # From 6-6, 2 points are played (one by P1, one by P2)
            # P1 wins both points: p1 * (1 - p2) = p1 * q2
            # P2 wins both points: (1 - p1) * p2 = q1 * p2
            p_p1_two_pts = p1 * q2
            p_p2_two_pts = q1 * p2
            p1_win_from_6_6 = p_p1_two_pts / max(1e-9, (p_p1_two_pts + p_p2_two_pts))
            p1_wins_tiebreak += prob_6_6 * p1_win_from_6_6

        return max(0.0, min(1.0, p1_wins_tiebreak))

    @classmethod
    def set_outcome_probabilities(cls, p1_serve_pt: float, p2_serve_pt: float, first_server: int = 1) -> Dict[str, Any]:
        """
        Calculates exact joint distribution of game scores in a set:
        Returns:
        - p1_win_set: Total probability P1 wins the set
        - score_distribution: Exact probabilities for 6-0, 6-1, 6-2, 6-3, 6-4, 7-5, 7-6, 0-6, etc.
        - expected_total_games: Expected number of games played in the set
        """
        p1_hold = cls.game_hold_probability(p1_serve_pt)
        p2_hold = cls.game_hold_probability(p2_serve_pt)

        # dp[(i, j)] = probability of reaching score i games to j games
        dp = {}
        dp[(0, 0)] = 1.0
        scores = {}

        # Simulate game transitions up to 12 games (6-6)
        for total_games in range(0, 12):
            for i in range(total_games + 1):
                j = total_games - i
                if (i, j) not in dp:
                    continue

                prob = dp[(i, j)]
                if prob <= 0.0:
                    continue

                # Server of game: game 0 is first_server, game 1 is opposite, etc.
                server = first_server if (total_games % 2 == 0) else (2 if first_server == 1 else 1)

                # Prob P1 wins this game
                p1_wins_game = p1_hold if server == 1 else (1.0 - p2_hold)

                # Case 1: P1 wins game -> (i + 1, j)
                if i + 1 == 6 and j <= 4:
                    scores[f"6-{j}"] = scores.get(f"6-{j}", 0.0) + prob * p1_wins_game
                elif i + 1 == 7 and j == 5:
                    scores["7-5"] = scores.get("7-5", 0.0) + prob * p1_wins_game
                elif i + 1 <= 6 or (i + 1 == 6 and j == 5):
                    dp[(i + 1, j)] = dp.get((i + 1, j), 0.0) + prob * p1_wins_game

                # Case 2: P2 wins game -> (i, j + 1)
                p2_wins_game = 1.0 - p1_wins_game
                if j + 1 == 6 and i <= 4:
                    scores[f"{i}-6"] = scores.get(f"{i}-6", 0.0) + prob * p2_wins_game
                elif j + 1 == 7 and i == 5:
                    scores["5-7"] = scores.get("5-7", 0.0) + prob * p2_wins_game
                elif j + 1 <= 6 or (j + 1 == 6 and i == 5):
                    dp[(i, j + 1)] = dp.get((i, j + 1), 0.0) + prob * p2_wins_game

        # Tiebreak at 6-6
        prob_6_6 = dp.get((6, 6), 0.0)
        if prob_6_6 > 0.0:
            p1_tb = cls.tiebreak_win_probability(p1_serve_pt, p2_serve_pt, first_server=first_server)
            scores["7-6"] = prob_6_6 * p1_tb
            scores["6-7"] = prob_6_6 * (1.0 - p1_tb)

        p1_win_set = sum(prob for sc, prob in scores.items() if int(sc.split("-")[0]) > int(sc.split("-")[1]))

        # Calculate expected total games
        expected_games = 0.0
        for sc, prob in scores.items():
            g1, g2 = map(int, sc.split("-"))
            expected_games += (g1 + g2) * prob

        return {
            "p1_win_set": round(p1_win_set, 4),
            "p2_win_set": round(1.0 - p1_win_set, 4),
            "score_distribution": {k: round(v, 4) for k, v in scores.items()},
            "expected_set_games": round(expected_games, 2),
            "p1_hold_rate": round(p1_hold, 4),
            "p2_hold_rate": round(p2_hold, 4)
        }

    @classmethod
    def match_probabilities(cls, p1_serve_pt: float, p2_serve_pt: float, best_of_sets: int = 3) -> Dict[str, Any]:
        """
        Computes match-level probabilities across Best-of-3 or Best-of-5 sets.
        """
        set_stats = cls.set_outcome_probabilities(p1_serve_pt, p2_serve_pt, first_server=1)
        p_set = set_stats["p1_win_set"]
        q_set = 1.0 - p_set

        if best_of_sets == 5:
            # Best of 5 (First to 3 sets)
            p_3_0 = math.pow(p_set, 3)
            p_3_1 = 3.0 * math.pow(p_set, 3) * q_set
            p_3_2 = 6.0 * math.pow(p_set, 3) * math.pow(q_set, 2)
            p1_match = p_3_0 + p_3_1 + p_3_2

            p_0_3 = math.pow(q_set, 3)
            p_1_3 = 3.0 * math.pow(q_set, 3) * p_set
            p_2_3 = 6.0 * math.pow(q_set, 3) * math.pow(p_set, 2)

            correct_scores = {
                "3-0": round(p_3_0, 4), "3-1": round(p_3_1, 4), "3-2": round(p_3_2, 4),
                "0-3": round(p_0_3, 4), "1-3": round(p_1_3, 4), "2-3": round(p_2_3, 4)
            }
            expected_sets = 3.0 * (p_3_0 + p_0_3) + 4.0 * (p_3_1 + p_1_3) + 5.0 * (p_3_2 + p_2_3)
        else:
            # Best of 3 (First to 2 sets)
            p_2_0 = math.pow(p_set, 2)
            p_2_1 = 2.0 * math.pow(p_set, 2) * q_set
            p1_match = p_2_0 + p_2_1

            p_0_2 = math.pow(q_set, 2)
            p_1_2 = 2.0 * math.pow(q_set, 2) * p_set

            correct_scores = {
                "2-0": round(p_2_0, 4), "2-1": round(p_2_1, 4),
                "0-2": round(p_0_2, 4), "1-2": round(p_1_2, 4)
            }
            expected_sets = 2.0 * (p_2_0 + p_0_2) + 3.0 * (p_2_1 + p_1_2)

        expected_total_games = round(expected_sets * set_stats["expected_set_games"], 1)

        return {
            "p1_win_match": round(p1_match, 4),
            "p2_win_match": round(1.0 - p1_match, 4),
            "set_stats": set_stats,
            "correct_set_scores": correct_scores,
            "expected_sets": round(expected_sets, 2),
            "expected_total_games": expected_total_games
        }
