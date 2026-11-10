import asyncio
import json
import os
import random
import sqlite3
import time
from collections import Counter
from pathlib import Path
from zoneinfo import ZoneInfoNotFoundError
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from providers import ProviderError, demo, live_weather
from nba import game_window, live_nba
from rail import live_rail

ROOT = Path(__file__).resolve().parent
POLICY = {"weather": (900, 60), "transport": (120, 60), "nba": (1800, 120)}


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
                        retry_at=retry_at, expires_at=record["fetched_at"] + expiry if record else None)

        if mode == "live" and kind == "nba" and not os.getenv("BALLDONTLIE_API_KEY", "").strip():
            return result(old, "unavailable", "Set BALLDONTLIE_API_KEY on the Pharos server to enable live NBA.")
        if cache_only or (old and not force and now - old["fetched_at"] < max(age, minimum)):
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
                    }[kind]
                    payload, source = await asyncio.wait_for(asyncio.to_thread(provider, *args), timeout=5)
                else:
                    payload = await asyncio.wait_for(
                        asyncio.to_thread(self.provider, kind, options, source), timeout=5)
                if kind == "nba" and "start" in options:
                    payload = [game for game in payload if options["start"] <= game["at"] < options["end"]]
                record = dict(payload=payload, fetched_at=self.clock(), source_at=source)
                with self.db:
                    self.db.execute("INSERT OR REPLACE INTO cache VALUES (?, ?)", (key, json.dumps(record)))
                self.errors.pop(key, None)
                return result(record, "ok")
            except Exception as exc:
                delay = min(900, minimum * 2 ** min(failures, 5)) + random.uniform(0, 5)
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
async def data(kind: Literal["weather", "transport", "nba"],
               mode: Literal["demo", "live"] = "demo",
               location: str = Query("Brisbane", max_length=80),
               origin: str = Query("Wooloowin", max_length=80),
               destination: str = Query("", max_length=80),
               team: str = Query("", max_length=3),
               zone: str = Query("Australia/Brisbane", max_length=80),
               max_age: int = Query(300, ge=60, le=7200),
               demo_clock: int | None = Query(None, ge=0, le=4102444800),
               force: bool = False, cache_only: bool = False):
    options = {"weather": {"location": location}, "transport": {"origin": origin, "destination": destination},
               "nba": {}}[kind]
    if demo_clock is not None and mode == "demo":
        options["demo_clock"] = demo_clock
    if kind == "nba":
        options["zone"] = zone
        try:
            options["start"], options["end"] = game_window(options.get("demo_clock", cache.clock()), zone)
        except (ZoneInfoNotFoundError, ValueError) as error:
            raise HTTPException(status_code=422, detail="Unknown timezone") from error
    return await cache.get(kind, mode, options, max_age, force, cache_only)


@app.get("/api/diagnostics")
async def diagnostics():
    return dict(cache.counts)


app.mount("/", StaticFiles(directory=ROOT / "web", html=True), name="web")
