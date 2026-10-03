import os
import sys
import json

sys.path.insert(0, os.path.abspath("."))
sys.path.insert(0, os.path.abspath("python"))

from python.src.tennis.db import TennisDbClient

db = TennisDbClient()
resp = db.client.get(
    "/tennis_predictions",
    params={
        "prediction": "ilike.*Gauff*",
        "select": "id,settlement_status,prediction,probability,secondary_predictions,target_kickoff_at"
    }
)
preds = resp.json()
print(f"Found {len(preds)} Gauff predictions:")
for p in preds:
    print(f"ID: {p['id']} | Settlement: {p['settlement_status']} | Target: {p['target_kickoff_at']}")
    print(f"Primary: {p['prediction']} | Prob: {p['probability']}")
    print(f"Secondary: {json.dumps(p.get('secondary_predictions'), indent=2)}")
