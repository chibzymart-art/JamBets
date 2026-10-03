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
        "prediction": "ilike.*Medvedev*",
        "select": "id,prediction,probability,secondary_predictions"
    }
)
for p in resp.json():
    print(p['prediction'], p['probability'])
    for s in (p.get('secondary_predictions') or []):
        print(f"  {s.get('market')}: {s.get('prediction')} | {s.get('probability')}")
