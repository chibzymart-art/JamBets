import os
import sys

sys.path.insert(0, os.path.abspath("."))
sys.path.insert(0, os.path.abspath("python"))

from python.src.tennis.db import TennisDbClient

db = TennisDbClient()
r = db.client.get('/tennis_predictions', params={'select': 'id,settlement_status,fixture_id'}).json()
print(f'Total predictions in DB: {len(r)}')
statuses = {}
for x in r:
    st = x.get('settlement_status')
    statuses[st] = statuses.get(st, 0) + 1
print('Breakdown by status:', statuses)
