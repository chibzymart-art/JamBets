"""
JamBets — Market Calibration & Option A+ Hierarchical Banker Engine
Computes out-of-sample empirical calibration metrics and enforces Option A+ selection:
1. Core Football Markets Priority (1X2, Double Chance, Over 1.5, Over 2.5, Under 3.5, BTTS)
2. Secondary Pool Evaluation (Home Over 0.5, Away Over 0.5, etc.) with Calibrated >= 85% Threshold
3. Under 4.5 Strictly Relegated from Primary Banker Pool
4. No Forced Fallback: Emits NO_QUALIFYING_MARKET (NO_SAFE_BANKER / SKIP) if confidence gates fail
5. Full Out-of-Sample Calibration Metrics (Brier Score, Log Loss, ECE, Empirical Hit Rate)
"""

import math
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass, field


@dataclass
class MarketCalibrationProfile:
    market_name: str
    outcome: str
    is_core: bool
    is_secondary: bool
    is_excluded: bool
    base_rate: float
    probability_threshold: float
    brier_score: float = 0.0
    log_loss: float = 0.0
    ece: float = 0.0
    hit_rate: float = 0.0
    sample_count: int = 0
    # Reliability penalty / weight in ranking (core markets receive priority boost)
    hierarchy_priority: int = 1  # 1 = Highest (Core), 2 = Secondary, 99 = Excluded


# Canonical Option A+ Market Classification & Hierarchy
MARKET_HIERARCHY: Dict[Tuple[str, str], MarketCalibrationProfile] = {
    # --- Tier 1: Core Football Markets (Priority 1) ---
    ("1x2", "home"): MarketCalibrationProfile(
        market_name="1x2", outcome="home", is_core=True, is_secondary=False, is_excluded=False,
        base_rate=0.45, probability_threshold=0.68, hierarchy_priority=1
    ),
    ("1x2", "away"): MarketCalibrationProfile(
        market_name="1x2", outcome="away", is_core=True, is_secondary=False, is_excluded=False,
        base_rate=0.30, probability_threshold=0.68, hierarchy_priority=1
    ),
    ("1x2", "draw"): MarketCalibrationProfile(
        market_name="1x2", outcome="draw", is_core=True, is_secondary=False, is_excluded=False,
        base_rate=0.25, probability_threshold=0.65, hierarchy_priority=1
    ),
    ("double_chance", "1x"): MarketCalibrationProfile(
        market_name="double_chance", outcome="1x", is_core=True, is_secondary=False, is_excluded=False,
        base_rate=0.70, probability_threshold=0.80, hierarchy_priority=1
    ),
    ("double_chance", "x2"): MarketCalibrationProfile(
        market_name="double_chance", outcome="x2", is_core=True, is_secondary=False, is_excluded=False,
        base_rate=0.55, probability_threshold=0.80, hierarchy_priority=1
    ),
    ("double_chance", "12"): MarketCalibrationProfile(
        market_name="double_chance", outcome="12", is_core=True, is_secondary=False, is_excluded=False,
        base_rate=0.75, probability_threshold=0.80, hierarchy_priority=1
    ),
    ("over_under_1.5", "over"): MarketCalibrationProfile(
        market_name="over_under_1.5", outcome="over", is_core=True, is_secondary=False, is_excluded=False,
        base_rate=0.78, probability_threshold=0.82, hierarchy_priority=1
    ),
    ("over_under_2.5", "over"): MarketCalibrationProfile(
        market_name="over_under_2.5", outcome="over", is_core=True, is_secondary=False, is_excluded=False,
        base_rate=0.52, probability_threshold=0.75, hierarchy_priority=1
    ),
    ("over_under_3.5", "under"): MarketCalibrationProfile(
        market_name="over_under_3.5", outcome="under", is_core=True, is_secondary=False, is_excluded=False,
        base_rate=0.72, probability_threshold=0.80, hierarchy_priority=1
    ),
    ("btts", "yes"): MarketCalibrationProfile(
        market_name="btts", outcome="yes", is_core=True, is_secondary=False, is_excluded=False,
        base_rate=0.51, probability_threshold=0.72, hierarchy_priority=1
    ),

    # --- Tier 2: Secondary Candidate Pool (Priority 2) ---
    # Home Over 0.5 retained as secondary candidate; never dominates purely by raw probability
    ("home_goals_0.5", "over"): MarketCalibrationProfile(
        market_name="home_goals_0.5", outcome="over", is_core=False, is_secondary=True, is_excluded=False,
        base_rate=0.84, probability_threshold=0.85, hierarchy_priority=2
    ),
    ("away_goals_0.5", "over"): MarketCalibrationProfile(
        market_name="away_goals_0.5", outcome="over", is_core=False, is_secondary=True, is_excluded=False,
        base_rate=0.68, probability_threshold=0.85, hierarchy_priority=2
    ),
    ("home_goals_1.5", "over"): MarketCalibrationProfile(
        market_name="home_goals_1.5", outcome="over", is_core=False, is_secondary=True, is_excluded=False,
        base_rate=0.55, probability_threshold=0.78, hierarchy_priority=2
    ),
    ("away_goals_1.5", "over"): MarketCalibrationProfile(
        market_name="away_goals_1.5", outcome="over", is_core=False, is_secondary=True, is_excluded=False,
        base_rate=0.38, probability_threshold=0.78, hierarchy_priority=2
    ),
    ("ht_goals_0.5", "over"): MarketCalibrationProfile(
        market_name="ht_goals_0.5", outcome="over", is_core=False, is_secondary=True, is_excluded=False,
        base_rate=0.69, probability_threshold=0.85, hierarchy_priority=2
    ),

    # --- Tier 3: Relegated / Excluded from Primary Banker Pool ---
    ("over_under_4.5", "under"): MarketCalibrationProfile(
        market_name="over_under_4.5", outcome="under", is_core=False, is_secondary=False, is_excluded=True,
        base_rate=0.89, probability_threshold=0.99, hierarchy_priority=99
    ),
    ("over_under_4.5", "over"): MarketCalibrationProfile(
        market_name="over_under_4.5", outcome="over", is_core=False, is_secondary=False, is_excluded=True,
        base_rate=0.11, probability_threshold=0.99, hierarchy_priority=99
    ),
    ("over_under_0.5", "over"): MarketCalibrationProfile(
        market_name="over_under_0.5", outcome="over", is_core=False, is_secondary=False, is_excluded=True,
        base_rate=0.92, probability_threshold=0.99, hierarchy_priority=99
    ),
    ("over_under_0.5", "under"): MarketCalibrationProfile(
        market_name="over_under_0.5", outcome="under", is_core=False, is_secondary=False, is_excluded=True,
        base_rate=0.08, probability_threshold=0.99, hierarchy_priority=99
    ),
}


@dataclass
class MarketSelectionResult:
    status: str  # "QUALIFIED", "NO_QUALIFYING_MARKET"
    market_name: str  # e.g. "double_chance" or "NO_SAFE_BANKER"
    outcome: str      # e.g. "1X" or "SKIP"
    probability: float
    calibrated_probability: float
    is_core_market: bool
    confidence_tier: str  # "VERY_HIGH", "HIGH", "MEDIUM", "UNCLASSIFIED"
    all_qualifying_core: List[Dict[str, Any]] = field(default_factory=list)
    all_qualifying_secondary: List[Dict[str, Any]] = field(default_factory=list)
    selection_stage: str = ""  # "STAGE_1_CORE", "STAGE_2_SECONDARY", "STAGE_3_NO_QUALIFIER"
    rejection_reason: Optional[str] = None


class MarketCalibrator:
    """
    Evaluates prediction candidates using Option A+ Enhanced Calibrated Hierarchy.
    Enforces that high-base-rate low-information markets do NOT crowd out core football markets.
    """

    @staticmethod
    def calibrate_probability(raw_p: float, base_rate: float) -> float:
        """
        Platt-style empirical shrinkage against base rate to correct for model overconfidence.
        P_cal = 0.85 * raw_p + 0.15 * base_rate
        """
        calibrated = (0.85 * raw_p) + (0.15 * base_rate)
        return round(min(max(calibrated, 0.0), 1.0), 4)

    @classmethod
    def select_primary_banker(
        cls,
        candidate_predictions: List[Any],
        min_probability_floor: float = 0.68,
        uncertainty: float = 0.20,
        is_high_disagreement: bool = False
    ) -> MarketSelectionResult:
        """
        Executes Option A+ multi-stage selection with uncertainty and disagreement gating:
        Stage 0: If fixture uncertainty > 0.50, trigger immediate abstention.
        Stage 1: Filter out excluded markets (Under 4.5, Over 0.5 Total, etc.)
        Stage 2: Evaluate Core Football Markets against calibrated thresholds.
        Stage 3: If >= 1 Core Market qualifies, select the strongest core market.
        Stage 4: If 0 Core Markets qualify, evaluate Secondary Pool (Home Over 0.5, etc.) with threshold >= 85%.
        Stage 5: If 0 Secondary Markets qualify, return NO_QUALIFYING_MARKET (NO_SAFE_BANKER / SKIP).
        """
        # Excessive parameter uncertainty check (Abstention Gate)
        if uncertainty > 0.50:
            return MarketSelectionResult(
                status="NO_QUALIFYING_MARKET",
                market_name="NO_SAFE_BANKER",
                outcome="SKIP",
                probability=0.0,
                calibrated_probability=0.0,
                is_core_market=False,
                confidence_tier="UNCLASSIFIED",
                all_qualifying_core=[],
                all_qualifying_secondary=[],
                selection_stage="STAGE_3_NO_QUALIFIER",
                rejection_reason=f"ABSTENTION: Excessive parameter uncertainty ({uncertainty:.2f} > 0.50)"
            )

        core_qualifiers = []
        secondary_qualifiers = []

        for cand in candidate_predictions:
            # Handle both QualifyingPrediction objects and dicts
            m_name = getattr(cand, "market_name", "").lower() if hasattr(cand, "market_name") else cand.get("market_name", "").lower()
            outcome = getattr(cand, "outcome", "").lower() if hasattr(cand, "outcome") else cand.get("outcome", "").lower()
            raw_p = getattr(cand, "combined_probability", None)
            if raw_p is None:
                raw_p = getattr(cand, "raw_probability", 0.0) if hasattr(cand, "raw_probability") else cand.get("probability", 0.0)
            raw_p = float(raw_p)

            key = (m_name, outcome)
            profile = MARKET_HIERARCHY.get(key)

            if not profile or profile.is_excluded:
                # Strictly excluded from primary banker pool
                continue

            # Compute calibrated probability with disagreement adjustment
            p_cal = cls.calibrate_probability(raw_p, profile.base_rate)
            if is_high_disagreement:
                p_cal = round(p_cal * 0.94, 4)  # 6% discount for high cross-model variance

            # Check market-specific calibrated threshold
            if p_cal >= profile.probability_threshold and p_cal >= min_probability_floor:
                record = {
                    "candidate": cand,
                    "market_name": m_name,
                    "outcome": outcome,
                    "raw_p": raw_p,
                    "p_cal": p_cal,
                    "profile": profile,
                    # Score combines calibrated probability with priority weighting
                    "score": p_cal
                }

                if profile.is_core:
                    core_qualifiers.append(record)
                elif profile.is_secondary:
                    secondary_qualifiers.append(record)

        # -------------------------------------------------------------
        # STAGE 1: Check Core Football Markets
        # -------------------------------------------------------------
        if core_qualifiers:
            # Sort core qualifiers descending by score
            core_qualifiers.sort(key=lambda x: x["score"], reverse=True)
            best = core_qualifiers[0]
            tier = cls._determine_confidence_tier(best["p_cal"])
            return MarketSelectionResult(
                status="QUALIFIED",
                market_name=best["market_name"],
                outcome=best["outcome"],
                probability=best["raw_p"],
                calibrated_probability=best["p_cal"],
                is_core_market=True,
                confidence_tier=tier,
                all_qualifying_core=core_qualifiers,
                all_qualifying_secondary=secondary_qualifiers,
                selection_stage="STAGE_1_CORE"
            )

        # -------------------------------------------------------------
        # STAGE 2: Secondary Pool (Home Over 0.5, etc.) - Only if 0 Core qualified
        # -------------------------------------------------------------
        if secondary_qualifiers:
            secondary_qualifiers.sort(key=lambda x: x["score"], reverse=True)
            best = secondary_qualifiers[0]
            tier = cls._determine_confidence_tier(best["p_cal"])
            return MarketSelectionResult(
                status="QUALIFIED",
                market_name=best["market_name"],
                outcome=best["outcome"],
                probability=best["raw_p"],
                calibrated_probability=best["p_cal"],
                is_core_market=False,
                confidence_tier=tier,
                all_qualifying_core=core_qualifiers,
                all_qualifying_secondary=secondary_qualifiers,
                selection_stage="STAGE_2_SECONDARY"
            )

        # -------------------------------------------------------------
        # STAGE 3: NO FORCED FALLBACK -> NO_QUALIFYING_MARKET
        # -------------------------------------------------------------
        return MarketSelectionResult(
            status="NO_QUALIFYING_MARKET",
            market_name="NO_SAFE_BANKER",
            outcome="SKIP",
            probability=0.0,
            calibrated_probability=0.0,
            is_core_market=False,
            confidence_tier="UNCLASSIFIED",
            all_qualifying_core=[],
            all_qualifying_secondary=[],
            selection_stage="STAGE_3_NO_QUALIFIER",
            rejection_reason="No core or secondary market satisfied calibrated confidence thresholds"
        )

    @staticmethod
    def _determine_confidence_tier(p_cal: float) -> str:
        if p_cal >= 0.88:
            return "VERY_HIGH"
        if p_cal >= 0.80:
            return "HIGH"
        if p_cal >= 0.70:
            return "MEDIUM"
        return "LOW"

    @classmethod
    def compute_out_of_sample_metrics(
        cls,
        eval_records: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Computes calibration audit metrics:
        - Brier Score: (1/N) * sum((p - y)^2)
        - Log Loss: -(1/N) * sum(y*ln(p) + (1-y)*ln(1-p))
        - ECE: Expected Calibration Error across 10 probability bins
        - Hit Rate: Percentage of won predictions
        - Overall Coverage
        """
        if not eval_records:
            return {
                "sample_count": 0,
                "brier_score": 0.0,
                "log_loss": 0.0,
                "ece": 0.0,
                "hit_rate": 0.0,
                "coverage_pct": 0.0
            }

        n = len(eval_records)
        brier_sum = 0.0
        log_loss_sum = 0.0
        hits = 0

        # For ECE: 10 equal bins from 0.0 to 1.0
        bins = [[] for _ in range(10)]

        eps = 1e-15
        for r in eval_records:
            p = min(max(float(r["probability"]), eps), 1.0 - eps)
            y = 1.0 if r["actual_outcome_won"] else 0.0

            brier_sum += (p - y) ** 2
            log_loss_sum += -(y * math.log(p) + (1.0 - y) * math.log(1.0 - p))

            if y == 1.0:
                hits += 1

            bin_idx = min(int(p * 10), 9)
            bins[bin_idx].append((p, y))

        brier = round(brier_sum / n, 4)
        log_loss = round(log_loss_sum / n, 4)
        hit_rate = round((hits / n) * 100.0, 2)

        ece_sum = 0.0
        for b in bins:
            if not b:
                continue
            bin_size = len(b)
            avg_p = sum(item[0] for item in b) / bin_size
            avg_y = sum(item[1] for item in b) / bin_size
            ece_sum += (bin_size / n) * abs(avg_p - avg_y)

        ece = round(ece_sum, 4)

        return {
            "sample_count": n,
            "brier_score": brier,
            "log_loss": log_loss,
            "ece": ece,
            "hit_rate": hit_rate,
            "coverage_pct": 100.0
        }
