import sqlite3
from contextlib import closing
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from providers import ProviderError
from shares import MARKET_ZONE, UPDATE_TIMES, next_check, normalize_quotes, reserve
from datetime import datetime


class SharesTests(unittest.TestCase):
    def test_change_uses_previous_close_and_missing_quotes_fail(self):
        data = [dict(code=symbol+".AU", close=11, previousClose=10, timestamp=1000)
                for symbol in ("WOW", "WDS", "VHY")]
        self.assertAlmostEqual(normalize_quotes(data)[0]["change"], 10)
        with self.assertRaises(ProviderError):
            normalize_quotes(data[:2])

    def test_budget_survives_connections_and_caps_requests(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "budget.sqlite3"
            with patch("shares.BUDGET_PATH", path):
                slots = [datetime(2026,11,11,hour,minute,tzinfo=MARKET_ZONE).timestamp()
                         for hour,minute in UPDATE_TIMES]
                for slot in slots:
                    reserve(slot)
                    with self.assertRaises(ProviderError):
                        reserve(slot+1)
                with self.assertRaises(ProviderError):
                    reserve(slots[-1]+3600)
            with closing(sqlite3.connect(path)) as db:
                self.assertEqual(db.execute("SELECT sum(calls) FROM budget").fetchone()[0], 18)

    def test_schedule_boundaries_weekend_and_daylight_saving(self):
        def instant(value):
            return datetime.fromisoformat(value).timestamp()
        self.assertEqual(next_check(instant("2026-11-11T10:20:00+11:00")),
                         instant("2026-11-11T11:12:00+11:00"))
        self.assertEqual(next_check(instant("2026-11-13T16:00:00+11:00")),
                         instant("2026-11-16T10:00:00+11:00"))
        self.assertEqual(next_check(instant("2026-07-01T09:59:59+10:00")),
                         instant("2026-07-01T10:00:00+10:00"))
