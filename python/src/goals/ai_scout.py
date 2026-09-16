"""
JamBets — Grounded Gemini AI Tactical Scout for Over 2.5 Goals
Evaluates tactical matchups, style clashes, and motivational intent.
Strictly grounded in verified empirical metrics and Match Intent Index (MII).
Zero artificial heuristic adjustments on unobserved teams.
"""

import os
import sys
import json
from typing import Dict, Any, Optional

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..')))

try:
    from google import genai
    from google.genai import types
    _has_genai = True
except ImportError:
    _has_genai = False


class GroundedGoalsAiScout:
    """
    Qualitative tactical scout analyzing matchup dynamics.
    Grounded strictly in empirical data and match intent.
    """

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        self.client = None
        if _has_genai and self.api_key:
            try:
                self.client = genai.Client(api_key=self.api_key)
            except Exception:
                self.client = None

    def analyze_fixture_goals(
        self,
        home_team: str,
        away_team: str,
        league_name: str,
        lambda_h: float,
        lambda_a: float,
        p_over25: float,
        p_btts: float,
        mii: float,
        intent_classification: str,
        home_over25_rate: int,
        away_over25_rate: int,
        home_clean_sheet_rate: int,
        away_clean_sheet_rate: int
    ) -> Dict[str, Any]:
        """
        Runs qualitative tactical evaluation.
        Falls back to deterministic grounded analysis if Gemini is unreachable.
        """
        if self.client:
            try:
                return self._call_gemini(
                    home_team=home_team,
                    away_team=away_team,
                    league_name=league_name,
                    lambda_h=lambda_h,
                    lambda_a=lambda_a,
                    p_over25=p_over25,
                    p_btts=p_btts,
                    mii=mii,
                    intent_classification=intent_classification,
                    home_over25_rate=home_over25_rate,
                    away_over25_rate=away_over25_rate,
                    home_clean_sheet_rate=home_clean_sheet_rate,
                    away_clean_sheet_rate=away_clean_sheet_rate
                )
            except Exception:
                pass

        # Grounded heuristic analysis (zero artificial boost)
        return self._grounded_heuristic_analysis(
            home_team=home_team,
            away_team=away_team,
            lambda_h=lambda_h,
            lambda_a=lambda_a,
            p_over25=p_over25,
            p_btts=p_btts,
            mii=mii,
            intent_classification=intent_classification
        )

    def _call_gemini(
        self,
        home_team: str,
        away_team: str,
        league_name: str,
        lambda_h: float,
        lambda_a: float,
        p_over25: float,
        p_btts: float,
        mii: float,
        intent_classification: str,
        home_over25_rate: int,
        away_over25_rate: int,
        home_clean_sheet_rate: int,
        away_clean_sheet_rate: int
    ) -> Dict[str, Any]:
        """Queries Gemini with deep statistical context."""
        prompt = f"""
You are a senior football quant and tactical analyst at JamBets.
Analyze the following football fixture specifically for Over 2.5 Goals:

Fixture: {home_team} vs {away_team}
Competition: {league_name}
Projected Goals (Dixon-Coles): {home_team} ({lambda_h:.2f}) vs {away_team} ({lambda_a:.2f})
Total Expected Goals: {lambda_h + lambda_a:.2f}
Analytical Probabilities: Over 2.5 = {p_over25*100:.1f}%, BTTS = {p_btts*100:.1f}%
Match Intent Index (MII): {mii:.2f} ({intent_classification})
Historical Form: Home Over 2.5 Rate = {home_over25_rate}%, Away Over 2.5 Rate = {away_over25_rate}%
Clean Sheet Rates: Home Team = {home_clean_sheet_rate}%, Away Team = {away_clean_sheet_rate}%

Provide your tactical evaluation strictly in valid JSON format:
{{
  "goal_tempo": "HIGH_TEMPO" | "BALANCED" | "DEFENSIVE_LOW_BLOCK",
  "tactical_rationale": "2 punchy, insightful sentences explaining why this match will or will not exceed 2.5 goals based on styles and intent.",
  "over25_adjustment": float between -0.03 and +0.03,
  "confidence_score": integer between 60 and 95
}}
"""
        response = self.client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.2,
                response_mime_type="application/json"
            )
        )

        data = json.loads(response.text.strip())
        adj = max(-0.03, min(0.03, float(data.get("over25_adjustment", 0.0))))
        conf = max(60, min(95, int(data.get("confidence_score", 75))))

        return {
            "tactical_rationale": data.get("tactical_rationale", ""),
            "goal_tempo": data.get("goal_tempo", "BALANCED"),
            "over25_adjustment": adj,
            "ai_confidence": conf,
            "source": "gemini-2.5-flash"
        }

    def _grounded_heuristic_analysis(
        self,
        home_team: str,
        away_team: str,
        lambda_h: float,
        lambda_a: float,
        p_over25: float,
        p_btts: float,
        mii: float,
        intent_classification: str
    ) -> Dict[str, Any]:
        """
        Deterministic, mathematically grounded tactical analysis.
        IMPORTANT: Leaves adjustment at 0.00 to avoid artificial qualification loops.
        """
        xg_comb = lambda_h + lambda_a

        if mii >= 1.10 and p_btts >= 0.58 and xg_comb >= 3.00:
            tempo = "HIGH_TEMPO"
            rationale = (
                f"{home_team} and {away_team} demonstrate complementary attacking profiles with a high projected goal volume ({xg_comb:.2f} xG). "
                f"With mutual open transition intent and a {p_btts*100:.0f}% BTTS likelihood, match conditions strongly favor Over 2.5."
            )
        elif mii <= 0.90 or min(lambda_h, lambda_a) < 0.90:
            tempo = "DEFENSIVE_LOW_BLOCK"
            rationale = (
                f"Tactical posture ({intent_classification}) and asymmetric goal expectation favor a compact structure. "
                f"Scoring opportunities are constrained, elevating risk for a low-scoring grinder."
            )
        else:
            tempo = "BALANCED"
            rationale = (
                f"{home_team} and {away_team} exhibit balanced regular-season tempo with {xg_comb:.2f} projected goals. "
                f"Scoring progression aligns with league averages, requiring efficient finishing to eclipse 2.5."
            )

        return {
            "tactical_rationale": rationale,
            "goal_tempo": tempo,
            "over25_adjustment": 0.0,  # Zero artificial boost
            "ai_confidence": int(p_over25 * 100),
            "source": "grounded_heuristic"
        }
