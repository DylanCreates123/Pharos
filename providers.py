def demo(kind, options, now):
    if kind == "weather":
        return dict(location=options["location"], temp=25, high=27, low=19,
                    condition="Partly cloudy", rain=20)
    if kind == "transport":
        return [dict(at=now // 60 * 60 + minutes * 60, platform=2,
                     prediction=i % 2 == 0)
                for i, minutes in enumerate((4, 12, 24, 39, 53))]
    start = options.get("start", now // 86400 * 86400)
    return [dict(at=start + hours * 3600, away=away, home=home, score=score)
            for hours, away, home, score in ((9, "NYK", "LAL", "113–107"),
                (20, "BOS", "NYK", None), (22, "OKC", "GSW", None),
                (34, "LAL", "OKC", None), (38, "GSW", "BOS", None))]


# Live weather uses public HTTPS endpoints and the same normalized record as demo.
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from functools import lru_cache
import json
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class ProviderError(Exception):
    def __init__(self, message, retry_after=0):
        super().__init__(message)
        self.retry_after = retry_after


def get_json(endpoint, *, headers=None, provider="Open-Meteo", **params):
    try:
        request = Request(endpoint + "?" + urlencode(params), headers=headers or {})
        with urlopen(request, timeout=2) as response:
            return json.load(response)
    except HTTPError as error:
        value = error.headers.get("Retry-After", "")
        try:
            delay = int(value) if value.isdigit() else (
                parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds()
        except (TypeError, ValueError):
            delay = 0
        message = f"{provider} rate limited this request." if error.code == 429 else f"{provider} is unavailable."
        if error.code in (401, 403):
            message = f"{provider} rejected access. Check the provider credentials and plan."
        raise ProviderError(message, max(0, delay)) from error


@lru_cache(maxsize=32)
def coordinates(location):
    if location.casefold() == "brisbane":
        return -27.4698, 153.0251, "Brisbane"
    data = get_json("https://geocoding-api.open-meteo.com/v1/search",
                    name=location, count=1, language="en")
    if not data.get("results"):
        raise ProviderError("Location not found. Check the weather location in Settings.")
    place = data["results"][0]
    return place["latitude"], place["longitude"], place["name"]


def live_weather(options):
    lat, lon, location = coordinates(options["location"].strip())
    data = get_json("https://api.open-meteo.com/v1/forecast",
                    latitude=lat, longitude=lon, timezone="auto", forecast_days=1,
                    timeformat="unixtime", current="temperature_2m,weather_code",
                    daily="temperature_2m_max,temperature_2m_min,precipitation_probability_max")
    current, daily = data["current"], data["daily"]
    code = current["weather_code"]
    condition = next((label for maximum, label in (
        (0, "Clear"), (2, "Partly cloudy"), (3, "Overcast"), (48, "Fog"),
        (57, "Drizzle"), (67, "Rain"), (77, "Snow"), (82, "Showers"),
        (86, "Snow showers"), (99, "Thunderstorms")) if code <= maximum), "Conditions unavailable")
    return dict(location=location, temp=current["temperature_2m"],
                high=daily["temperature_2m_max"][0], low=daily["temperature_2m_min"][0],
                rain=daily["precipitation_probability_max"][0], condition=condition), current["time"]
