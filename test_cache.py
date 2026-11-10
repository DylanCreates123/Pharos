import asyncio
import os
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("PHAROS_CACHE", ":memory:")
from app import Cache


class CacheTests(unittest.IsolatedAsyncioTestCase):
    async def test_shared_cooldown_and_restart(self):
        clock = [1000]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cache.sqlite3"
            service = Cache(path, lambda: clock[0], lambda *_: [1])
            options = {"origin": "Wooloowin"}
            args = ("transport", "demo", options, 60)
            results = await asyncio.gather(*(service.get(*args) for _ in range(12)))
            self.assertTrue(all(result["payload"] == [1] for result in results))
            self.assertEqual(service.counts["transport.requests"], 1)
            self.assertEqual((await service.get(*args, force=True))["status"], "cooldown")
            self.assertEqual((await service.get("transport", "demo", {"origin": "Other"}, 60))["status"], "cooldown")
            service.db.close()

            clock[0] += 125
            service = Cache(path, lambda: clock[0])
            record = await service.get(*args, cache_only=True)
            self.assertEqual(record["fetched_at"], 1000)
            self.assertLess(record["expires_at"], clock[0])
            self.assertIsNone((await service.get("transport", "live", options, 60, cache_only=True)).get("payload"))
            service.db.close()

    async def test_provider_failure_preserves_data_and_retry_after(self):
        clock = [1000]

        class Throttled(Exception):
            retry_after = 240

        def provider(*args):
            if clock[0] > 1000:
                raise Throttled()
            return [1]

        service = Cache(":memory:", lambda: clock[0], provider)
        args = ("transport", "demo", {}, 60)
        await service.get(*args)
        clock[0] += 61
        result = await service.get(*args)
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["retry_at"], 1301)
        self.assertEqual(result["payload"], [1])
        self.assertEqual((await service.get(*args, force=True))["status"], "cooldown")
        service.db.close()
