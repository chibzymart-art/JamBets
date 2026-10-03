import os
import sys

sys.path.insert(0, os.path.abspath("."))
sys.path.insert(0, os.path.abspath("python"))

from python.src.tennis.db import TennisDbClient

db = TennisDbClient()
won_preds = db.client.get(
    "/tennis_predictions",
    params={
        "settlement_status": "eq.won",
        "select": "id,fixture_id,prediction,probability,secondary_predictions"
    }
).json()

print(f"Total won predictions: {len(won_preds)}")
legacy_mw_count = 0
for p in won_preds:
    secs = p.get("secondary_predictions") or []
    markets = [s.get("market") for s in secs]
    if "match_winner" in markets:
        legacy_mw_count += 1

print(f"Won predictions containing legacy 'match_winner': {legacy_mw_count} / {len(won_preds)}")
