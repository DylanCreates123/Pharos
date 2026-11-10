"""BALLDONTLIE schedule and final scores, with a server-only API key."""
import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from providers import ProviderError, get_json

GAMES_URL = "https://api.balldontlie.io/v1/games"

def normalize_games(games, team):
    result = []
    for game in games:
        home = game["home_team"]["abbreviation"]
        away = game["visitor_team"]["abbreviation"]
        if (team and team not in (home, away)) or game.get("postponed"):
            continue
        status = game.get("status", "")
        state = game.get("status_state")
        final = state == "final" or (not state and status.startswith("Final"))
        scheduled = state == "scheduled" or (not state and status.endswith(" ET"))
        if not (final or scheduled) or not game.get("datetime"):
            continue
        at = datetime.fromisoformat(game["datetime"].replace("Z", "+00:00")).timestamp()
        score = f'{game["visitor_team_score"]}–{game["home_team_score"]}' if final else None
        result.append(dict(at=at, home=home, away=away, score=score))
    return sorted(result, key=lambda game: game["at"])


def live_nba(options, now):
    key = os.getenv("BALLDONTLIE_API_KEY", "").strip()
    if not key:
        raise ProviderError("Set BALLDONTLIE_API_KEY on the Pharos server to enable live NBA.")
    start, end = game_window(now, options.get("zone", "Australia/Brisbane"))
    eastern = ZoneInfo("America/New_York")
    params = dict(start_date=datetime.fromtimestamp(start, eastern).date(),
                  end_date=datetime.fromtimestamp(end - 1, eastern).date(), per_page=100)
    data = get_json(GAMES_URL, headers={"Authorization": key}, provider="BALLDONTLIE", **params)
    games = data["data"]
    cursor = data.get("meta", {}).get("next_cursor")
    if cursor is not None:
        games += get_json(GAMES_URL, headers={"Authorization": key}, provider="BALLDONTLIE",
                          cursor=cursor, **params)["data"]
    return [game for game in normalize_games(games, "")
            if start <= game["at"] < end], None


def game_window(now, zone):
    today = datetime.fromtimestamp(now, ZoneInfo(zone)).replace(hour=0, minute=0, second=0, microsecond=0)
    return today.timestamp(), (today + timedelta(days=2)).timestamp()
