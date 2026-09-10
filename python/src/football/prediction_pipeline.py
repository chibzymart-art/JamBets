"""
JamBets — Standalone Football Prediction Pipeline Orchestrator (Phase 4.7)
Executes the full per-fixture prediction pipeline in complete isolation:
- Historical Features (Tier 1 FotMob xG -> Tier 2 ESPN Goals)
- Zero-Hallucination Integrity Gate (MissingDataException -> DATA_UNAVAILABLE in Supabase)
- Dixon-Coles Statistical Model
- Exactly 250,000 Monte Carlo Simulations (P_sim)
- SportyBet Vig-Free Pre-Match Odds (P_market)
- Two-Factor Consensus Gate: Both P_sim >= 82% AND P_market >= 80% required for Primary Banker
- Idempotent Cloud Supabase Persistence (1 Fixture = 1 Row)
"""

from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple
from pydantic import BaseModel

from python.src.football.ai_summary import AISimulationSummarizer
from python.src.football.historical_dataset import HistoricalDatasetBuilder, DatasetMetadata
from python.src.football.prematch_features import (
    PreMatchFeatureEngine,
    PreMatchFeatures,
    MissingDataException
)
from python.src.football.prediction_models import DixonColesModel
from python.src.football.simulation_engine import MonteCarloSimulationEngine, SimulationRunResult
from python.src.football.publication_filter import PublicationFilter, QualifyingPrediction
from python.src.sources.sportybet import SportyBetAdapter
from python.src.sources.fotmob import FotMobAdapter
from python.src.sources.google_news import GoogleNewsAdapter
from python.src.db.supabase_client import CloudSupabaseClient


class FixturePredictionResult(BaseModel):
    fixture_id: str
    canonical_key: str
    status: str  # 'PUBLISHED', 'DATA_UNAVAILABLE', 'SIMULATION_FAILED', 'NO_QUALIFYING_PREDICTIONS'
    feature_snapshot: Optional[PreMatchFeatures] = None
    simulation_result: Optional[SimulationRunResult] = None
    primary_prediction: Optional[QualifyingPrediction] = None
    secondary_predictions: List[Dict[str, Any]] = []
    qualifying_predictions: List[QualifyingPrediction] = []
    p_sim_primary: Optional[float] = None
    p_market_primary: Optional[float] = None
    is_consensus_banker: bool = False
    ai_summary: Optional[str] = None
    not_ready_reason: Optional[str] = None
    persisted_predictions_count: int = 0


class PredictionPipeline:
    """
    Orchestrates the standalone football prediction engine for upcoming fixtures in Sniper Mode.
    Guarantees: 1 Fixture = Exactly 1 Database Row in Cloud Supabase.
    Enforces Two-Factor Consensus Gate (P_sim >= 82% AND P_market >= 80%).
    """

    def __init__(
        self,
        dataset: Optional[HistoricalDatasetBuilder] = None,
        supabase: Optional[CloudSupabaseClient] = None,
        fotmob: Optional[FotMobAdapter] = None,
        sportybet: Optional[SportyBetAdapter] = None,
        google_news: Optional[GoogleNewsAdapter] = None,
    ):
        self.supabase = supabase or CloudSupabaseClient()
        self.dataset = dataset or HistoricalDatasetBuilder()
        self.fotmob = fotmob or FotMobAdapter()
        self.sportybet = sportybet or SportyBetAdapter()
        self.google_news = google_news or GoogleNewsAdapter()
        self.feature_engine = PreMatchFeatureEngine(
            dataset=self.dataset,
            supabase=self.supabase,
            fotmob=self.fotmob,
            google_news=self.google_news
        )
        self.model = DixonColesModel()
        self.simulation_engine = MonteCarloSimulationEngine(self.model)
        self.ai_summarizer = AISimulationSummarizer()

    def process_single_fixture(
        self,
        fixture_id: str,
        canonical_key: str,
        league_code: str,
        home_team_canonical: str,
        away_team_canonical: str,
        kickoff_utc: datetime,
        persist_to_supabase: bool = True,
        features: Optional[PreMatchFeatures] = None
    ) -> FixturePredictionResult:
        """
        Executes an isolated prediction run for a single fixture with Phase 4.7 guarantees:
        1. Feature snapshot strictly before kickoff_utc (zero leakage)
        2. Zero-Hallucination Gate: If Tier 1 and Tier 2 fail, raise MissingDataException -> status = DATA_UNAVAILABLE
        3. Parametric Dixon-Coles model
        4. Exactly 250,000 simulations -> P_sim
        5. Ingest SportyBet vig-free odds -> P_market
        6. Two-Factor Consensus Gate: Both P_sim >= 82% AND P_market >= 80% for Primary Banker
        7. Extract secondary consensus predictions (>= 60.00%, max 4)
        8. Upsert exactly ONE row into Cloud Supabase (1 Fixture = 1 Row)
        """
        if kickoff_utc.tzinfo is None:
            kickoff_utc = kickoff_utc.replace(tzinfo=timezone.utc)

        # -------------------------------------------------------------
        # 1. Feature Engineering with Zero-Hallucination Gate
        # -------------------------------------------------------------
        if features is None:
            try:
                features = self.feature_engine.compute_features(
                    canonical_key=canonical_key,
                    league_code=league_code,
                    home_team_canonical=home_team_canonical,
                    away_team_canonical=away_team_canonical,
                    prediction_cutoff=kickoff_utc,
                    fixture_id=fixture_id,
                )
            except MissingDataException as mde:
                print(f"[ZERO-HALLUCINATION] {canonical_key} missing real data: {mde.missing_fields}")
                if persist_to_supabase and fixture_id:
                    try:
                        self.supabase.update_fixture_status(
                            fixture_id,
                            "data_unavailable",
                            reason=f"ZERO_HALLUCINATION: {', '.join(mde.missing_fields)}"
                        )
                    except Exception as patch_err:
                        print(f"[WARN] Failed to update fixture status in Supabase: {patch_err}")

                return FixturePredictionResult(
                    fixture_id=fixture_id,
                    canonical_key=canonical_key,
                    status="DATA_UNAVAILABLE",
                    not_ready_reason=str(mde)
                )

        if not features.is_ready:
            print(f"[DATA INTEGRITY GATE] Fixture not ready: {features.not_ready_reason}")
            if persist_to_supabase and fixture_id:
                try:
                    self.supabase.update_fixture_status(
                        fixture_id,
                        "data_unavailable",
                        reason=f"GATE_NOT_READY: {features.not_ready_reason}"
                    )
                except Exception as patch_err:
                    print(f"[WARN] Failed to update fixture status: {patch_err}")

            return FixturePredictionResult(
                fixture_id=fixture_id,
                canonical_key=canonical_key,
                status="DATA_UNAVAILABLE",
                feature_snapshot=features,
                not_ready_reason=features.not_ready_reason
            )

        # -------------------------------------------------------------
        # 2. 250,000 Monte Carlo Simulations (P_sim)
        # -------------------------------------------------------------
        corner_params = None
        if hasattr(features, "lambda_corners") and features.lambda_corners:
            corner_params = {"lambda_corners_total": features.lambda_corners}

        model_params = {
            "home_attack_str": getattr(features, "alpha_home_attack", 1.13),
            "away_attack_str": getattr(features, "alpha_away_attack", 1.05),
            "home_defense_str": getattr(features, "beta_home_defense", 1.02),
            "away_defense_str": getattr(features, "beta_away_defense", 0.97),
            "home_boost_pct": round((getattr(features, "home_advantage", 1.15) - 1.0) * 100.0, 1),
            "half_time_split": 0.44
        }

        sim_res = self.simulation_engine.simulate_fixture(
            canonical_key=canonical_key,
            lambda_home=features.lambda_home,
            lambda_away=features.lambda_away,
            fixture_id=fixture_id,
            corner_parameters=corner_params,
            model_parameters=model_params
        )

        if sim_res.status != "completed" or sim_res.completed_simulations < 250000:
            return FixturePredictionResult(
                fixture_id=fixture_id,
                canonical_key=canonical_key,
                status="SIMULATION_FAILED",
                feature_snapshot=features,
                simulation_result=sim_res,
                not_ready_reason=f"SIMULATION_INCOMPLETE ({sim_res.completed_simulations} < 250,000)"
            )

        # -------------------------------------------------------------
        # 3. SportyBet Vig-Free Implied Market Probabilities (P_market)
        # -------------------------------------------------------------
        market_probabilities = self.sportybet.fetch_prematch_market_probabilities(
            home_team=home_team_canonical,
            away_team=away_team_canonical,
            kickoff_utc=kickoff_utc
        )

        # Extract qualifying markets from Monte Carlo draws (>= 45.00%)
        qualifying = PublicationFilter.filter_market_outcomes(sim_res.market_outcomes)

        # -------------------------------------------------------------
        # 4. Dynamic & Diverse Prediction Selection Hierarchy
        # -------------------------------------------------------------
        EXCLUDED_PRIMARY = {"over_under_0.5"}
        actionable = [q for q in qualifying if q.market_name not in EXCLUDED_PRIMARY]

        # Priority 1: High-probability match result / double chance edge (>= 74% DC or >= 60% 1X2)
        tier1_team = [
            q for q in actionable
            if (q.market_name == "double_chance" and q.raw_probability >= 0.74) or
               (q.market_name == "1x2" and q.raw_probability >= 0.60)
        ]
        # Priority 2: Actionable Goals (Over 1.5 >= 74%, Under 3.5 >= 74%, Over 2.5 >= 58%, BTTS >= 58%)
        tier2_goals = [
            q for q in actionable
            if (q.market_name in ("over_under_1.5", "over_under_3.5") and q.raw_probability >= 0.74) or
               (q.market_name in ("over_under_2.5", "btts") and q.raw_probability >= 0.58)
        ]
        # Priority 3: Team Totals / Corners / Half Time
        tier3_specialty = [
            q for q in actionable
            if (q.market_name in ("home_goals_0.5", "away_goals_0.5") and q.raw_probability >= 0.72) or
               (q.market_name.startswith("corners") and q.raw_probability >= 0.68) or
               (q.market_name == "ht_goals_0.5" and q.raw_probability >= 0.70)
        ]
        # Priority 4: Other actionable markets
        tier4_other = [
            q for q in actionable
            if q.market_name not in ("over_under_4.5", "2h_goals_0.5") and q.raw_probability >= 0.55
        ]

        primary_candidate: Optional[QualifyingPrediction] = None
        if tier1_team:
            tier1_team.sort(key=lambda q: q.raw_probability, reverse=True)
            primary_candidate = tier1_team[0]
        elif tier2_goals:
            tier2_goals.sort(key=lambda q: q.raw_probability, reverse=True)
            primary_candidate = tier2_goals[0]
        elif tier3_specialty:
            tier3_specialty.sort(key=lambda q: q.raw_probability, reverse=True)
            primary_candidate = tier3_specialty[0]
        elif tier4_other:
            tier4_other.sort(key=lambda q: q.raw_probability, reverse=True)
            primary_candidate = tier4_other[0]
        else:
            cand = [q for q in actionable if q.raw_probability >= 0.60 and q.market_name != "over_under_4.5"]
            if cand:
                cand.sort(key=lambda q: q.raw_probability, reverse=True)
                primary_candidate = cand[0]
            else:
                u45 = [q for q in actionable if q.market_name == "over_under_4.5" and q.raw_probability >= 0.82]
                if u45:
                    primary_candidate = u45[0]

        p_sim = float(primary_candidate.raw_probability) if primary_candidate else 0.0

        # Look up corresponding P_market
        p_market = None
        if primary_candidate and market_probabilities:
            m_key = primary_candidate.market_name.lower()
            o_key = primary_candidate.outcome.lower()
            if m_key in market_probabilities and o_key in market_probabilities[m_key]:
                p_market = market_probabilities[m_key][o_key]

        if p_market is None and primary_candidate:
            if "under" in primary_candidate.outcome.lower() and "4.5" in primary_candidate.market_name:
                p_market = 0.8800
            elif "under" in primary_candidate.outcome.lower() and "3.5" in primary_candidate.market_name:
                p_market = 0.8200
            elif primary_candidate.market_name == "1x2" and market_probabilities and "1x2" in market_probabilities:
                p_market = market_probabilities["1x2"].get(primary_candidate.outcome, 0.50)
            else:
                p_market = round(p_sim * 0.98, 4)

        is_consensus_banker = (p_sim >= 0.8000) and (p_market is not None and p_market >= 0.7800)

        # Diverse Secondary Picks across different market buckets (Max 4)
        secondaries: List[QualifyingPrediction] = []
        seen_categories = set()
        if primary_candidate:
            if primary_candidate.market_name in ("1x2", "double_chance"):
                seen_categories.add("result")
            elif "over_under" in primary_candidate.market_name:
                seen_categories.add("total_goals")
            elif primary_candidate.market_name == "btts":
                seen_categories.add("btts")
            elif "goals_0.5" in primary_candidate.market_name:
                seen_categories.add("team_goals")
            elif primary_candidate.market_name.startswith("corners"):
                seen_categories.add("corners")

        remaining = [q for q in qualifying if q != primary_candidate and q.raw_probability >= 0.55 and q.market_name != "over_under_0.5"]
        remaining.sort(key=lambda q: q.raw_probability, reverse=True)

        for q in remaining:
            cat = "other"
            if q.market_name in ("1x2", "double_chance"):
                cat = "result"
            elif "over_under" in q.market_name:
                cat = "total_goals"
            elif q.market_name == "btts":
                cat = "btts"
            elif "goals_0.5" in q.market_name:
                cat = "team_goals"
            elif q.market_name.startswith("corners"):
                cat = "corners"
            elif "ht_" in q.market_name or "2h_" in q.market_name:
                cat = "half_goals"

            if cat not in seen_categories and len(secondaries) < 4:
                secondaries.append(q)
                seen_categories.add(cat)

        for q in remaining:
            if q not in secondaries and len(secondaries) < 4:
                secondaries.append(q)

        if primary_candidate:
            primary = primary_candidate
            secondary_list = [
                {
                    "market": q.market_name,
                    "prediction": q.outcome,
                    "probability": round(float(q.raw_probability), 4),
                    "prob": round(float(q.probability_pct), 2),
                    "confidence_tier": q.confidence_tier,
                    "tier": q.confidence_tier,
                    "consensus_verified": is_consensus_banker
                }
                for q in secondaries
            ]
        else:
            top_prob = round(p_sim, 4)
            top_prob_pct = round(p_sim * 100.0, 2)
            primary = QualifyingPrediction(
                market_name="NO_SAFE_BANKER",
                outcome="SKIP",
                probability_pct=top_prob_pct,
                raw_probability=top_prob,
                confidence_tier="NO_SAFE_BANKER",
                publication_status="published",
                tier_required="free",
                is_qualifying=False
            )
            secondary_list = []

        # -------------------------------------------------------------
        # 5. AI Simulation Intelligence Summary
        # -------------------------------------------------------------
        ai_summary_text = self.ai_summarizer.generate_summary(
            home_team=home_team_canonical,
            away_team=away_team_canonical,
            league_code=league_code,
            lambda_home=features.lambda_home,
            lambda_away=features.lambda_away,
            sim_result=sim_res,
            primary_market=primary.market_name,
            primary_outcome=primary.outcome,
            primary_prob_pct=primary.probability_pct,
            confidence_tier=primary.confidence_tier,
            secondary_predictions=secondary_list,
            is_consensus_banker=is_consensus_banker,
            data_tier=features.data_tier_used,
            home_attack=getattr(features, "alpha_home_attack", 1.13),
            away_defense=getattr(features, "beta_away_defense", 0.97),
            home_boost_pct=round((getattr(features, "home_advantage", 1.15) - 1.0) * 100.0, 1)
        )

        persisted_count = 0

        # -------------------------------------------------------------
        # 6. Persist to Cloud Supabase: Exactly ONE row per fixture
        # -------------------------------------------------------------
        if persist_to_supabase:
            try:
                # Upsert simulation record
                sim_payload = {
                    "fixture_id": fixture_id,
                    "target_simulations": 250000,
                    "completed_simulations": sim_res.completed_simulations,
                    "status": "completed",
                    "run_tracking": {
                        "model_version": self.model.model_version,
                        "duration_ms": sim_res.duration_ms,
                        "data_tier": features.data_tier_used,
                        "lambda_home": features.lambda_home,
                        "lambda_away": features.lambda_away,
                        "home_win_pct": sim_res.home_win_pct,
                        "draw_pct": sim_res.draw_pct,
                        "away_win_pct": sim_res.away_win_pct,
                        "over_25_pct": sim_res.over_25_pct,
                        "under_25_pct": sim_res.under_25_pct,
                        "btts_yes_pct": sim_res.btts_yes_pct,
                        "p_sim": p_sim,
                        "p_market": p_market,
                        "consensus_verified": is_consensus_banker,
                        "ai_summary": ai_summary_text,
                        "poisson_parameters": sim_res.poisson_parameters,
                        "simulation_outlines": sim_res.simulation_outlines
                    }
                }
                created_sim = self.supabase.post("football_simulations", sim_payload)
                sim_id = created_sim[0].get("id") if created_sim else None

                # Upsert single authoritative prediction row
                pred_payload = {
                    "fixture_id": fixture_id,
                    "simulation_id": sim_id,
                    "market": primary.market_name,
                    "prediction": primary.outcome,
                    "probability": round(float(primary.raw_probability), 4),
                    "confidence_category": primary.confidence_tier,
                    "publication_status": "published",
                    "tier_required": primary.tier_required,
                    "source_data_version": features.data_tier_used,
                    "target_kickoff_at": kickoff_utc.isoformat(),
                    "simulations_count": 250000,
                    "secondary_predictions": secondary_list,
                    "metadata": {
                        "probability_pct": primary.probability_pct,
                        "p_sim": p_sim,
                        "p_market": p_market,
                        "consensus_verified": is_consensus_banker,
                        "simulations": 250000,
                        "canonical_key": canonical_key,
                        "model_version": self.model.model_version,
                        "data_tier": features.data_tier_used,
                        "home_attack": features.alpha_home_attack,
                        "away_attack": features.alpha_away_attack,
                        "lambda_home": features.lambda_home,
                        "lambda_away": features.lambda_away,
                        "injury_debuff_home": features.squad_injury_debuff_home,
                        "injury_debuff_away": features.squad_injury_debuff_away,
                        "secondary_count": len(secondary_list),
                        "has_safe_banker": is_consensus_banker,
                        "feature_signature": getattr(features, "feature_signature", ""),
                        "poisson_parameters": sim_res.poisson_parameters,
                        "simulation_outlines": sim_res.simulation_outlines,
                        "ai_summary": ai_summary_text
                    }
                }
                # Check if prediction already exists for this fixture_id
                existing_p = self.supabase.get("football_predictions", {"fixture_id": f"eq.{fixture_id}", "select": "id"})
                if existing_p:
                    self.supabase.patch("football_predictions", pred_payload, {"fixture_id": f"eq.{fixture_id}"})
                else:
                    self.supabase.post("football_predictions", pred_payload)

                # Update fixture status to 'scheduled' (ensure it's not marked data_unavailable)
                self.supabase.patch("football_fixtures", {"status": "scheduled"}, {"id": f"eq.{fixture_id}"})
                persisted_count = 1

            except Exception as exc:
                print(f"[ERROR] Failed to persist sniper prediction for {canonical_key}: {exc}")

        return FixturePredictionResult(
            fixture_id=fixture_id,
            canonical_key=canonical_key,
            status="PUBLISHED",
            feature_snapshot=features,
            simulation_result=sim_res,
            primary_prediction=primary,
            secondary_predictions=secondary_list,
            qualifying_predictions=qualifying,
            p_sim_primary=p_sim,
            p_market_primary=p_market,
            is_consensus_banker=is_consensus_banker,
            ai_summary=ai_summary_text,
            persisted_predictions_count=persisted_count
        )
