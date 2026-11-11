import asyncio
import json
import os
import random
import sqlite3
import sys
import time
from collections import Counter
from pathlib import Path
from zoneinfo import ZoneInfoNotFoundError
from typing import Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.staticfiles import StaticFiles
from providers import ProviderError, demo, live_weather, live_location
from nba import game_window, live_nba
from rail import live_rail
from nasa import DIRECTORY as WALLPAPERS, fetch_wallpaper
from shares import live_shares, next_check

ROOT = Path(__file__).resolve().parent
POLICY = {"weather": (900, 60), "transport": (120, 60), "nba": (1800, 120), "shares": (4320, 60), "location": (86400, 60), "wallpaper": (86400, 10)}


class Cache:
    def __init__(self, path, clock=time.time, provider=demo, weather_provider=live_weather):
        self.clock, self.provider = clock, provider
        self.weather_provider = weather_provider
        self.db = sqlite3.connect(path)
        self.db.execute("CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT)")
        self.inflight, self.cooldown, self.errors = {}, {}, {}
        self.counts = Counter()

    async def get(self, kind, mode, options, age, force=False, cache_only=False):
        key = json.dumps([kind, mode, options], sort_keys=True)
        if kind == "nba" and "start" in options and "demo_clock" not in options:
            with self.db:
                self.db.execute("""
                    DELETE FROM cache WHERE json_extract(key, '$[0]') = 'nba'
                    AND json_extract(key, '$[1]') = ?
                    AND (json_extract(key, '$[2].start') IS NULL OR
                         (json_extract(key, '$[2].zone') = ? AND
                          json_extract(key, '$[2].demo_clock') IS NULL AND
                          json_extract(key, '$[2].start') < ?))
                """, (mode, options["zone"], options["start"]))
        now = self.clock()
        row = self.db.execute("SELECT value FROM cache WHERE key = ?", (key,)).fetchone()
        old = json.loads(row[0]) if row else None
        expiry, minimum = POLICY[kind]

        def result(record, status, error=None, retry_at=None):
            return dict(record or {}, key=key, mode=mode, status=status, error=error,
                        next_refresh=next_check(record["fetched_at"]) if record and kind == "shares" and mode == "live" else None,
                        retry_at=retry_at, expires_at=record["fetched_at"] + expiry if record else None)

        if mode == "live" and kind == "nba" and not os.getenv("BALLDONTLIE_API_KEY", "").strip():
            return result(old, "unavailable", "Set BALLDONTLIE_API_KEY on the Pharos server to enable live NBA.")
        if kind == "shares" and mode == "live" and old and now < next_check(old["fetched_at"]):
            self.counts[f"{kind}.cache_hits"] += 1
            return result(old, "cached", retry_at=next_check(old["fetched_at"]))
        if cache_only or (old and not force and not (kind == "shares" and mode == "live")
                          and now - old["fetched_at"] < max(age, minimum)):
            if old:
                self.counts[f"{kind}.cache_hits"] += 1
            return result(old, "cached" if old else "empty")
        if key in self.inflight:
            return await asyncio.shield(self.inflight[key])
        failures, retry, error = self.errors.get(key, (0, 0, None))
        provider_key = (kind, mode)
        until = max(retry, self.cooldown.get(provider_key, 0))
        if now < until:
            return result(old, "cooldown", error, until)
        self.cooldown[provider_key] = now + minimum
        self.counts[f"{kind}.requests"] += 1

        async def run():
            try:
                source = options.get("demo_clock", now)
                if mode == "live":
                    provider, args = {
                        "weather": (self.weather_provider, (options,)),
                        "transport": (live_rail, (options, now)),
                        "nba": (live_nba, (options, now)),
                        "shares": (live_shares, (options, now)),
                        "location": (live_location, (options, now)),
                        "wallpaper": (fetch_wallpaper, (options, now)),
                    }[kind]
                    payload, source = await asyncio.wait_for(asyncio.to_thread(provider, *args),
                                                            timeout=12 if kind == "wallpaper" else 5)
                else:
                    payload = await asyncio.wait_for(
                        asyncio.to_thread(self.provider, kind, options, source), timeout=5)
                if kind == "nba" and "start" in options:
                    payload = [game for game in payload if options["start"] <= game["at"] < options["end"]]
                record = dict(payload=payload, fetched_at=self.clock(), source_at=source)
                with self.db:
                    self.db.execute("INSERT OR REPLACE INTO cache VALUES (?, ?)", (key, json.dumps(record)))
                self.errors.pop(key, None)
                return result(record, "ok", retry_at=next_check(record["fetched_at"])
                              if kind == "shares" and mode == "live" else None)
            except Exception as exc:
                delay = min(900, minimum * 2 ** min(failures, 5)) + random.uniform(0, 5)
                if kind == "shares" and mode == "live":
                    delay = max(delay, next_check(self.clock())-self.clock())
                retry_at = self.clock() + max(delay, getattr(exc, "retry_after", 0) or 0)
                error = "Provider timed out." if isinstance(exc, TimeoutError) else "Provider unavailable."
                if isinstance(exc, ProviderError):
                    error = str(exc)
                self.errors[key] = (failures + 1, retry_at, error)
                return result(old, "error", error, retry_at)
            finally:
                self.inflight.pop(key, None)

        self.inflight[key] = asyncio.create_task(run())
        return await asyncio.shield(self.inflight[key])


app = FastAPI()
cache = Cache(os.environ.get("PHAROS_CACHE", ROOT / "pharos-cache.sqlite3"))


@app.get("/api/data/{kind}")
async def data(kind: Literal["weather", "transport", "nba", "shares"],
               mode: Literal["demo", "live"] = "demo",
               location: str = Query("Brisbane", max_length=80),
               origin: str = Query("Wooloowin", max_length=80),
               destination: str = Query("", max_length=80),
               team: str = Query("", max_length=3),
               zone: str = Query("Australia/Brisbane", max_length=80),
               max_age: int = Query(300, ge=60, le=7200),
               demo_clock: int | None = Query(None, ge=0, le=4102444800),
               force: bool = False, cache_only: bool = False):
    options = {"weather": {"location": location, "forecast_days": 2}, "transport": {"origin": origin, "destination": destination},
               "nba": {"score_version": 2}, "shares": {}}[kind]
    if demo_clock is not None and mode == "demo":
        options["demo_clock"] = demo_clock
    if kind == "nba":
        options["zone"] = zone
        try:
            options["start"], options["end"] = game_window(options.get("demo_clock", cache.clock()), zone)
        except (ZoneInfoNotFoundError, ValueError) as error:
            raise HTTPException(status_code=422, detail="Unknown timezone") from error
    return await cache.get(kind, mode, options, max_age, force, cache_only)


@app.get("/api/wallpaper/{collection}")
async def wallpaper(collection: Literal["daily", "nebula", "earth", "planets"]):
    return await cache.get("wallpaper", "live", {"collection": collection}, 86400)


@app.get("/api/location")
async def location_info(location: str = Query("Brisbane", min_length=1, max_length=80)):
    return await cache.get("location", "live", {"location": location.strip()}, 86400)


@app.get("/api/diagnostics")
async def diagnostics():
    return dict(cache.counts)


@app.post("/api/power/{action}", status_code=202)
async def power(action: Literal["exit", "shutdown"], request: Request):
    if sys.platform != "linux" or os.getenv("PHAROS_ENABLE_POWER") != "1":
        raise HTTPException(status_code=404)
    if (not request.client or request.client.host not in ("127.0.0.1", "::1")
            or request.url.hostname not in ("127.0.0.1", "localhost")
            or request.headers.get("origin") != f"{request.url.scheme}://{request.url.netloc}"):
        raise HTTPException(status_code=403)
    command = ("systemctl", "--user", "--no-block", "stop", "pharos-kiosk.service")
    if action == "shutdown":
        command = ("systemctl", "--no-block", "poweroff")
    try:
        process = await asyncio.create_subprocess_exec(
            *command, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
        await asyncio.wait_for(process.wait(), timeout=3)
    except (OSError, TimeoutError) as error:
        raise HTTPException(status_code=503, detail="Power action unavailable") from error
    if process.returncode:
        raise HTTPException(status_code=503, detail="Power action unavailable")
    return {"accepted": True}


app.mount("/wallpapers", StaticFiles(directory=WALLPAPERS), name="wallpapers")
app.mount("/", StaticFiles(directory=ROOT / "web", html=True), name="web")
