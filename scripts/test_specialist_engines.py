"""
JamBets / Oddsbanta — Phase 2 Specialist Engines Verification Suite
Verifies:
1. Corners Set-Piece GLM Engine (Negative Binomial, PMF, Line probabilities)
2. Specialist Settlement Pipeline (Corners verified settlements)
"""

import sys
import os
import unittest

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from python.src.corners.negative_binomial_corners import NegativeBinomialCornersModel
from python.src.engines.corners_engine import CornersEngine
from python.src.engines.specialist_settlements import SpecialistSettlementPipeline
from python.src.db.supabase_client import CloudSupabaseClient


class TestSpecialistEngines(unittest.TestCase):

    def setUp(self):
        self.db = CloudSupabaseClient()

    # =========================================================================
    # 1. CORNERS SPECIALIST NEGATIVE BINOMIAL VERIFICATION
    # =========================================================================
    def test_corners_negative_binomial_monotonicity(self):
        """Verifies Negative Binomial Set-Piece GLM and line probability monotonicity."""
        # Test PMF properties
        pmf_0 = NegativeBinomialCornersModel.pmf(0, 10.0, 8.5)
        self.assertGreater(pmf_0, 0.0)
        self.assertLess(pmf_0, 1.0)

        # Monotonicity test: P(Over 7.5) > P(Over 8.5) > P(Over 9.5) > P(Over 10.5)
        probs = NegativeBinomialCornersModel.calculate_tail_probabilities(mu_total=10.5)
        p75 = probs["over_7_5_prob"]
        p85 = probs["over_8_5_prob"]
        p95 = probs["over_9_5_prob"]
        p105 = probs["over_10_5_prob"]

        self.assertGreater(p75, p85, "Over 7.5 probability must exceed Over 8.5")
        self.assertGreater(p85, p95, "Over 8.5 probability must exceed Over 9.5")
        self.assertGreater(p95, p105, "Over 9.5 probability must exceed Over 10.5")

    def test_corners_engine_structure(self):
        """Verifies CornersEngine methods and attributes."""
        engine = CornersEngine(db=self.db)
        self.assertIsNotNone(engine.db)
        self.assertIsNotNone(engine.data_provider)
        self.assertTrue(hasattr(engine, 'run'))

    def test_specialist_settlement_pipeline(self):
        """Verifies SpecialistSettlementPipeline initialization and corners method."""
        pipeline = SpecialistSettlementPipeline(db=self.db)
        self.assertIsNotNone(pipeline.db)
        self.assertTrue(hasattr(pipeline, 'settle_corners'))
        self.assertTrue(hasattr(pipeline, 'settle_all'))


def run_tests():
    print("=================================================================")
    print(" 🧪 Oddsbanta — Decoupled Specialist Engines Unit Test Suite")
    print("=================================================================\n")
    suite = unittest.TestLoader().loadTestsFromTestCase(TestSpecialistEngines)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    if not result.wasSuccessful():
        print("\n❌ Tests failed!")
        sys.exit(1)
    print("\n✅ All Mathematical Engine Unit Tests Passed!")


if __name__ == "__main__":
    run_tests()
