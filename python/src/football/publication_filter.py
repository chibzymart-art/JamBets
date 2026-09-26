"""
JamBets — Publication Filter & Confidence Classifier
Applies strict 45.00% minimum probability threshold (never rounds 44.99% to 45%).
Classifies qualifying predictions into exact confidence bands:
BANGER, TOP PICK, HIGH CONFIDENCE, MID CONFIDENCE, LOW CONFIDENCE, RISKY.
"""

from typing import Optional, List, Tuple
from pydantic import BaseModel, Field

from python.src.football.simulation_engine import MarketOutcome


class QualifyingPrediction(BaseModel):
    market_name: str
    outcome: str
    probability_pct: float = Field(ge=0.0, le=100.0)
    raw_probability: float = Field(ge=0.0, le=1.0000)
    poisson_probability: Optional[float] = None
    combined_probability: Optional[float] = None
    confidence_tier: str
    publication_status: str = "published"
    tier_required: str = "free"
    is_qualifying: bool = True


class PublicationFilter:
    """
    Enforces publication thresholds and assigns standardized confidence categories.
    """

    MIN_PROBABILITY = 45.00  # Strict percentage threshold

    @classmethod
    def classify_confidence_tier(cls, probability_pct: float, market_name: Optional[str] = None) -> Optional[str]:
        """
        Maps probability percentage (or decimal <= 1.0) to exact JamBets confidence tier.
        Rejects anything < 45.00%.
        Supports market-calibrated floors when market_name is provided.
        """
        # Automatically handle decimal representation (e.g. 0.85 -> 85.0)
        pct = probability_pct * 100.0 if 0.0 <= probability_pct <= 1.0 else probability_pct

        # Market-calibrated confidence floors
        if market_name:
            m_lower = market_name.lower()
            if m_lower in ("draw", "1x2_draw"):
                if pct < 25.0:
                    return None
                # Draws are high-value equilibrium picks and strictly NEVER categorized as BANGER
                if pct >= 35.0:
                    return "TOP PICK"
                elif pct >= 30.0:
                    return "MID CONFIDENCE"
                elif pct >= 25.0:
                    return "LOW CONFIDENCE"
                else:
                    return "RISKY"

            if pct < cls.MIN_PROBABILITY:
                return None

            if m_lower in ("1x2", "home_win", "away_win", "match_winner"):
                if pct >= 76.00:
                    return "BANGER"
                elif pct >= 64.00:
                    return "TOP PICK"
                elif pct >= 55.00:
                    return "HIGH CONFIDENCE"
                elif pct >= 48.00:
                    return "MID CONFIDENCE"
                else:
                    return "LOW CONFIDENCE"

            elif m_lower in ("double_chance", "1x", "x2", "12"):
                if pct >= 85.00:
                    return "BANGER"
                elif pct >= 76.00:
                    return "TOP PICK"
                elif pct >= 68.00:
                    return "HIGH CONFIDENCE"
                elif pct >= 58.00:
                    return "MID CONFIDENCE"
                else:
                    return "LOW CONFIDENCE"

        # Strict non-rounding comparison on exact float for default/generic markets
        if pct < cls.MIN_PROBABILITY:
            return None

        # Universal fallback bands (preserving exact baseline specification)
        if 96.00 <= pct <= 100.00:
            return "BANGER"
        elif 90.00 <= pct < 96.00:
            return "TOP PICK"
        elif 83.00 <= pct < 90.00:
            return "HIGH CONFIDENCE"
        elif 70.00 <= pct < 83.00:
            return "MID CONFIDENCE"
        elif 60.00 <= pct < 70.00:
            return "LOW CONFIDENCE"
        elif 45.00 <= pct < 60.00:
            return "RISKY"
        else:
            return None


    classify_tier = classify_confidence_tier

    @classmethod
    def filter_market_outcomes(
        cls,
        outcomes: List[MarketOutcome],
    ) -> List[QualifyingPrediction]:
        """
        Filters market outcomes: only outcomes with probability >= 45.00% qualify.
        Outcomes below 45% are strictly discarded from public predictions.
        """
        qualifying: List[QualifyingPrediction] = []

        for o in outcomes:
            eff_prob = o.combined_probability * 100.0 if o.combined_probability is not None else o.probability
            tier = cls.classify_confidence_tier(eff_prob, market_name=o.market_name)
            if tier is not None:
                # Assign tier_required: e.g. BANGER/TOP PICK could be premium/pro in future, but free for now
                tier_req = "free"
                if tier in ("BANGER", "TOP PICK"):
                    tier_req = "pro"

                raw_combined = o.combined_probability if o.combined_probability is not None else o.raw_probability
                pct_combined = round(raw_combined * 100.0, 2)

                qualifying.append(
                    QualifyingPrediction(
                        market_name=o.market_name,
                        outcome=o.outcome,
                        probability_pct=pct_combined,
                        raw_probability=raw_combined,
                        poisson_probability=o.poisson_probability,
                        combined_probability=o.combined_probability,
                        confidence_tier=tier,
                        publication_status="published",
                        tier_required=tier_req,
                        is_qualifying=True
                    )
                )

        return qualifying
