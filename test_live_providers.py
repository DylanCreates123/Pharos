import unittest
from unittest.mock import patch

from google.transit import gtfs_realtime_pb2

from nba import live_nba
from rail import predicted


class LiveProviderTests(unittest.TestCase):
    def test_nba_normalizes_games_and_drops_cancellations(self):
        base = dict(home_team={"abbreviation": "BOS"}, visitor_team={"abbreviation": "NYK"},
                    datetime="2026-11-10T01:00:00Z")
        games = [
            dict(base, status_state="scheduled"),
            dict(base, status_state="final", home_team_score=99, visitor_team_score=101),
            dict(base, status_state="canceled"),
            dict(base, status_state="scheduled", home_team={"abbreviation": "LAL"}),
        ]
        with patch.dict("os.environ", {"BALLDONTLIE_API_KEY": "test"}):
            with patch("nba.get_json", return_value={"data": games}) as fetch:
                result, source = live_nba({}, 1794293870)
        self.assertIsNone(source)
        self.assertEqual([game["score"] for game in result], [None, "101–99", None])
        self.assertEqual(result[0]["at"], 1794272400)
        self.assertEqual(fetch.call_args.kwargs["headers"], {"Authorization": "test"})

    def test_rail_fallback_delay_and_cancellation(self):
        self.assertEqual(predicted(None, "origin", 2, 1000), (1000, False))
        update = gtfs_realtime_pb2.TripUpdate()
        call = update.stop_time_update.add(stop_id="origin", stop_sequence=2)
        call.departure.delay = 45
        self.assertEqual(predicted(update, "origin", 2, 1000), (1045, True))
        call.schedule_relationship = 1
        self.assertEqual(predicted(update, "origin", 2, 1000), (None, False))
        update.trip.schedule_relationship = 3
        self.assertEqual(predicted(update, "origin", 2, 1000), (None, False))
