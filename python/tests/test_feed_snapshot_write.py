"""
Snapshot writes must upsert exactly as before but not ask Supabase to echo the payload back.
Offline: uses httpx.MockTransport, no network.
"""
import json
import unittest

import httpx

from python.src.engines.feed_snapshot_engine import FeedSnapshotEngine


def make_engine(handler):
    engine = FeedSnapshotEngine(url="https://db.test", service_key="test-service-key")
    engine.client = httpx.Client(
        base_url="https://db.test/rest/v1",
        headers=engine.headers,
        transport=httpx.MockTransport(handler),
    )
    return engine


class FeedSnapshotWriteTests(unittest.TestCase):
    def test_write_uses_return_minimal_and_keeps_upsert(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["method"] = request.method
            seen["path"] = request.url.path
            seen["on_conflict"] = request.url.params.get("on_conflict")
            seen["prefer"] = request.headers.get("prefer", "")
            seen["body"] = json.loads(request.content)
            return httpx.Response(201)  # what PostgREST returns for return=minimal: no body

        engine = make_engine(handler)
        ok = engine.write_snapshot("feed:tennis", {"predictions": [1, 2], "cached_at": "x"})

        self.assertTrue(ok)
        self.assertEqual(seen["method"], "POST")
        self.assertEqual(seen["path"], "/rest/v1/cached_feeds")
        self.assertEqual(seen["on_conflict"], "key")
        prefer = [p.strip() for p in seen["prefer"].split(",")]
        self.assertIn("return=minimal", prefer)
        self.assertIn("resolution=merge-duplicates", prefer)
        self.assertNotIn("return=representation", prefer)
        self.assertEqual(seen["body"]["key"], "feed:tennis")
        self.assertEqual(seen["body"]["payload"], {"predictions": [1, 2], "cached_at": "x"})
        self.assertIn("updated_at", seen["body"])

    def test_write_failure_still_reported(self):
        engine = make_engine(lambda request: httpx.Response(500, json={"message": "boom"}))
        self.assertFalse(engine.write_snapshot("feed:tennis", {"predictions": []}))


if __name__ == "__main__":
    unittest.main()
