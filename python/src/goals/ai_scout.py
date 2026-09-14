"""
Addsbanta — Gemini AI Tactical Scout for Goals & 1H Predictions
Uses Google GenAI SDK (Gemini 2.5 Flash) to analyze tactical matchups,
apply qualitative goal adjustments, and generate human-readable analytical rationales.
"""

import os
import json
import re
from typing import Dict, Any, Optional

try:
    from google import genai
    from google.genai import types
    _has_genai = True
except ImportError:
    _has_genai = False


class GoalsAiScout:
    """
    Autonomous AI Scout evaluating qualitative tactical dynamics:
    - High pressing vs low blocks
    - Early game tempo & 1H urgency
    - Qualitative adjustments to pure Poisson probabilities
    - Clear, insightful 2-sentence rationale for punters
    """

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        self.client = None
        if _has_genai and self.api_key:
            try:
                self.client = genai.Client(api_key=self.api_key)
            except Exception as e:
                print(f"[AI SCOUT NOTICE] Failed to initialize Gemini Client: {e}")

    def analyze_fixture_goals(
        self,
        home_team: str,
        away_team: str,
        league: str,
        lambda_home: float,
        lambda_away: float,
        prob_over25: float,
        prob_ht05: float,
        home_o25_rate: int,
        away_o25_rate: int,
        ht_goal_frequency: int
    ) -> Dict[str, Any]:
        """
        Runs qualitative tactical analysis on upcoming fixture.
        Returns tactical rationale, tempo classification, and fine-tuned adjustments.
        """
        # If Gemini API is available, perform live LLM tactical analysis
        if self.client:
            try:
                return self._call_gemini_analysis(
                    home_team=home_team,
                    away_team=away_team,
                    league=league,
                    lambda_home=lambda_home,
                    lambda_away=lambda_away,
                    prob_over25=prob_over25,
                    prob_ht05=prob_ht05,
                    home_o25_rate=home_o25_rate,
                    away_o25_rate=away_o25_rate,
                    ht_goal_frequency=ht_goal_frequency
                )
            except Exception as e:
                print(f"[AI SCOUT WARNING] Gemini API call failed ({e}), falling back to heuristic engine.")

        # Fallback to intelligent tactical heuristic engine
        return self._heuristic_tactical_analysis(
            home_team=home_team,
            away_team=away_team,
            league=league,
            lambda_home=lambda_home,
            lambda_away=lambda_away,
            prob_over25=prob_over25,
            prob_ht05=prob_ht05,
            ht_goal_frequency=ht_goal_frequency
        )

    def _call_gemini_analysis(
        self,
        home_team: str,
        away_team: str,
        league: str,
        lambda_home: float,
        lambda_away: float,
        prob_over25: float,
        prob_ht05: float,
        home_o25_rate: int,
        away_o25_rate: int,
        ht_goal_frequency: int
    ) -> Dict[str, Any]:
        prompt = f"""
You are a senior football tactical analyst and betting quantitative modeler for Addsbanta.
Analyze the following football fixture specifically for Over 2.5 Goals and 1st Half (1H) Over 0.5 Goals:

Fixture: {home_team} vs {away_team}
League: {league}
Model Projected Goals: {home_team} ({lambda_home:.2f}) vs {away_team} ({lambda_away:.2f})
Mathematical Probabilities: Over 2.5 = {prob_over25*100:.1f}%, 1H Over 0.5 = {prob_ht05*100:.1f}%
Historical Frequencies: Home Team Over 2.5 = {home_o25_rate}%, Away Team Over 2.5 = {away_o25_rate}%, Combined 1H Goal Freq = {ht_goal_frequency}%

Respond strictly in valid JSON format with these exact keys:
{{
  "goal_tempo": "HIGH_TEMPO" | "BALANCED" | "DEFENSIVE_LOW_BLOCK",
  "tactical_rationale": "2 concise, punchy sentences explaining tactical reasons for goal expectancy or early 1H tempo.",
  "over25_adjustment": float between -0.04 and +0.04,
  "ht05_adjustment": float between -0.04 and +0.04,
  "ai_confidence": integer between 60 and 95
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

        text = response.text.strip()
        data = json.loads(text)

        # Sanitize adjustments
        adj_o25 = max(-0.05, min(0.05, float(data.get("over25_adjustment", 0.0))))
        adj_ht = max(-0.05, min(0.05, float(data.get("ht05_adjustment", 0.0))))
        conf = max(50, min(98, int(data.get("ai_confidence", 75))))

        return {
            "tactical_rationale": data.get("tactical_rationale", ""),
            "goal_tempo": data.get("goal_tempo", "BALANCED"),
            "over25_adjustment": adj_o25,
            "ht05_adjustment": adj_ht,
            "ai_confidence": conf,
            "source": "gemini-2.5-flash"
        }

    def _heuristic_tactical_analysis(
        self,
        home_team: str,
        away_team: str,
        league: str,
        lambda_home: float,
        lambda_away: float,
        prob_over25: float,
        prob_ht05: float,
        ht_goal_frequency: int
    ) -> Dict[str, Any]:
        """Deterministic heuristic analysis when Gemini API key is not present."""
        xg_comb = lambda_home + lambda_away

        if xg_comb >= 3.1 or (prob_over25 >= 0.65 and prob_ht05 >= 0.75):
            tempo = "HIGH_TEMPO"
            rationale = (
                f"{home_team} and {away_team} exhibit aggressive transition play with high attacking volume ({xg_comb:.2f} expected goals). "
                f"With a {ht_goal_frequency}% historical 1H goal rate, expect early space behind defensive lines and high matchday scoring."
            )
            adj_o25 = +0.02
            adj_ht = +0.02
            conf = min(92, int(prob_over25 * 100 + 5))
        elif xg_comb <= 2.2 and prob_over25 < 0.48:
            tempo = "DEFENSIVE_LOW_BLOCK"
            rationale = (
                f"Both sides structure compact defensive mid-blocks that limit central progression and box entries. "
                f"Expect cautious opening stages with limited high-quality chances."
            )
            adj_o25 = -0.02
            adj_ht = -0.02
            conf = min(88, int((1.0 - prob_over25) * 100))
        else:
            tempo = "BALANCED"
            rationale = (
                f"{home_team} controls primary possession while {away_team} poses counter-attacking danger on the break. "
                f"Game state balance favors standard progression with scoring opportunities peaking around the 25th-35th minute."
            )
            adj_o25 = 0.0
            adj_ht = 0.0
            conf = int(prob_ht05 * 100)

        return {
            "tactical_rationale": rationale,
            "goal_tempo": tempo,
            "over25_adjustment": adj_o25,
            "ht05_adjustment": adj_ht,
            "ai_confidence": conf,
            "source": "heuristic_tactical_engine"
        }
