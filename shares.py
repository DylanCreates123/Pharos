"""ASX delayed quotes. Reserve the symbol-call budget before making a request."""
import math
import os
import sqlite3
from contextlib import closing
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from pathlib import Path

from providers import ProviderError, get_json

SYMBOLS = ("WOW", "WDS", "VHY")
UPDATE_TIMES = ((10, 0), (11, 12), (12, 24), (13, 36), (14, 48), (16, 0))
MARKET_ZONE = ZoneInfo("Australia/Sydney")
BUDGET_PATH = Path(__file__).with_name("shares-budget.sqlite3")


def schedule_for(local):
    return [local.replace(hour=hour, minute=minute, second=0, microsecond=0).timestamp()
            for hour, minute in UPDATE_TIMES] if local.weekday() < 5 else []


def next_check(now):
    local = datetime.fromtimestamp(now, MARKET_ZONE)
    for offset in range(8):
        for slot in schedule_for(local + timedelta(days=offset)):
            if slot > now:
                return slot
    raise ValueError("No upcoming ASX update slot")


def reserve(now):
    local = datetime.fromtimestamp(now, MARKET_ZONE)
    elapsed = [slot for slot in schedule_for(local) if slot <= now]
    if not elapsed:
        raise ProviderError("ASX quotes will update at the next scheduled time.", next_check(now)-now)
    slot = elapsed[-1]
    day = datetime.fromtimestamp(now, timezone.utc).date().isoformat()
    with closing(sqlite3.connect(BUDGET_PATH)) as db, db:
        db.execute("CREATE TABLE IF NOT EXISTS budget (day TEXT PRIMARY KEY, calls INTEGER, attempted REAL)")
        db.execute("CREATE TABLE IF NOT EXISTS slots (at REAL PRIMARY KEY)")
        db.execute("BEGIN IMMEDIATE")
        if db.execute("SELECT 1 FROM slots WHERE at=?", (slot,)).fetchone():
            raise ProviderError("ASX quotes will update at the next scheduled time.", next_check(now)-now)
        row = db.execute("SELECT calls FROM budget WHERE day=?", (day,)).fetchone()
        calls = row[0] if row else 0
        if calls + len(SYMBOLS) > 18:
            raise ProviderError("ASX daily request budget reached.", next_check(now)-now)
        db.execute("INSERT INTO slots VALUES (?)", (slot,))
        db.execute("INSERT OR REPLACE INTO budget VALUES (?,?,?)", (day, calls+len(SYMBOLS), now))


def normalize_quotes(data):
    quotes = {item.get("code"): item for item in data}
    result = []
    for symbol in SYMBOLS:
        item = quotes.get(symbol+".AU", {})
        price, previous, stamp = item.get("close"), item.get("previousClose"), item.get("timestamp")
        if not all(isinstance(value, (int, float)) and math.isfinite(value)
                   for value in (price, previous, stamp)) or price <= 0 or previous <= 0 or stamp <= 0:
            raise ProviderError("EODHD has no usable quote for "+symbol+".")
        result.append(dict(symbol=symbol, price=price, change=(price/previous-1)*100,
                           at=stamp, currency="AUD"))
    return result


def live_shares(options, now):
    token = os.getenv("EODHD_API_TOKEN", "").strip()
    if not token:
        raise ProviderError("Set EODHD_API_TOKEN on the Pharos server to enable ASX quotes.")
    reserve(now)
    data = get_json("https://eodhd.com/api/real-time/WOW.AU", provider="EODHD",
                    api_token=token, fmt="json", s="WDS.AU,VHY.AU")
    if not isinstance(data, list):
        raise ProviderError("EODHD returned an unexpected quote response.")
    quotes = normalize_quotes(data)
    return quotes, min(quote["at"] for quote in quotes)
