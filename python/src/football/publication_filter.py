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
    probability_pct: float = Field(ge=45.0, le=100.0)
    raw_probability: float = Field(ge=0.4500, le=1.0000)
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
    def classify_confidence_tier(cls, probability_pct: float) -> Optional[str]:
        """
        Maps probability percentage to exact JamBets confidence tier.
        Rejects anything < 45.00%.
        """
        # Strict non-rounding comparison on exact float
        if probability_pct < cls.MIN_PROBABILITY:
            return None

        if 96.00 <= probability_pct <= 100.00:
            return "BANGER"
        elif 90.00 <= probability_pct < 96.00:
            return "TOP PICK"
        elif 83.00 <= probability_pct < 90.00:
            return "HIGH CONFIDENCE"
        elif 70.00 <= probability_pct < 83.00:
            return "MID CONFIDENCE"
        elif 60.00 <= probability_pct < 70.00:
            return "LOW CONFIDENCE"
        elif 45.00 <= probability_pct < 60.00:
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
            tier = cls.classify_confidence_tier(o.probability)
            if tier is not None:
                # Assign tier_required: e.g. BANGER/TOP PICK could be premium/pro in future, but free for now
                tier_req = "free"
                if tier in ("BANGER", "TOP PICK"):
                    tier_req = "pro"

                qualifying.append(
                    QualifyingPrediction(
                        market_name=o.market_name,
                        outcome=o.outcome,
                        probability_pct=o.probability,
                        raw_probability=o.raw_probability,
                        confidence_tier=tier,
                        publication_status="published",
                        tier_required=tier_req,
                        is_qualifying=True
                    )
                )

        return qualifying
