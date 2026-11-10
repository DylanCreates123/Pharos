"""Import Translink's timetable once, then query a compact local rail index."""
import argparse
import csv
import io
import os
import shutil
import sqlite3
import tempfile
import zipfile
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import urlopen

from google.transit import gtfs_realtime_pb2

from providers import ProviderError

SCHEDULE_URL = "https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip"
UPDATES_URL = "https://gtfsrt.api.translink.com.au/api/realtime/SEQ/TripUpdates/Rail"
BRISBANE = timezone(timedelta(hours=10))
INDEX = Path(os.getenv("PHAROS_RAIL_INDEX", Path(__file__).with_name("rail-index.sqlite3")))
WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")


def rows(archive, name):
    with io.TextIOWrapper(archive.open(name + ".txt"), encoding="utf-8-sig") as stream:
        yield from csv.DictReader(stream)


def seconds(value):
    hours, minutes, secs = map(int, value.split(":"))
    return hours * 3600 + minutes * 60 + secs


def build_index(source, target):
    with zipfile.ZipFile(source) as archive, closing(sqlite3.connect(target)) as db, db:
        routes = {row["route_id"] for row in rows(archive, "routes") if row["route_type"] == "2"}
        trips = {row["trip_id"]: (row["service_id"], row["trip_headsign"])
                 for row in rows(archive, "trips") if row["route_id"] in routes}
        db.executescript("""
            CREATE TABLE stops (id TEXT PRIMARY KEY, name TEXT, platform TEXT);
            CREATE TABLE trips (id TEXT PRIMARY KEY, service TEXT, headsign TEXT);
            CREATE TABLE calls (trip TEXT, stop TEXT, seq INTEGER, departure INTEGER, pickup TEXT, dropoff TEXT);
            CREATE TABLE calendar (service TEXT, first TEXT, last TEXT, weekdays TEXT);
            CREATE TABLE exceptions (service TEXT, day TEXT, kind TEXT);
        """)
        db.executemany("INSERT INTO trips VALUES (?,?,?)", ((key, *value) for key, value in trips.items()))
        db.executemany("INSERT INTO stops VALUES (?,?,?)", (
            (row["stop_id"], row["stop_name"].split(", platform", 1)[0].strip().casefold(),
             row["platform_code"]) for row in rows(archive, "stops")))
        db.executemany("INSERT INTO calls VALUES (?,?,?,?,?,?)", (
            (row["trip_id"], row["stop_id"], int(row["stop_sequence"]),
             seconds(row["departure_time"]) if row["departure_time"] else None,
             row["pickup_type"], row["drop_off_type"])
            for row in rows(archive, "stop_times") if row["trip_id"] in trips))
        db.executemany("INSERT INTO calendar VALUES (?,?,?,?)", (
            (row["service_id"], row["start_date"], row["end_date"],
             "".join(row[day] for day in WEEKDAYS)) for row in rows(archive, "calendar")))
        db.executemany("INSERT INTO exceptions VALUES (?,?,?)", (
            (row["service_id"], row["date"], row["exception_type"])
            for row in rows(archive, "calendar_dates")))
        db.executescript("CREATE INDEX by_stop ON calls(stop); CREATE INDEX by_trip ON calls(trip, seq);")


def normalize_station(name):
    return name.strip().casefold().removesuffix(" station")


def station_ids(db, name):
    key = normalize_station(name)
    ids = [row[0] for row in db.execute("""
        SELECT DISTINCT s.id FROM stops s JOIN calls c ON c.stop = s.id
        WHERE s.name IN (?, ?)
    """, (key, key + " station"))]
    if not ids:
        raise ProviderError("Rail station not found: " + name)
    return ids


def get_updates(now):
    feed = gtfs_realtime_pb2.FeedMessage()
    try:
        with urlopen(UPDATES_URL, timeout=2) as response:
            feed.ParseFromString(response.read(4_000_000))
    except (OSError, ValueError):
        return {}, None
    stamp = feed.header.timestamp
    if not stamp or not 0 <= now - stamp <= 120:
        return {}, None
    return {(item.trip_update.trip.trip_id, item.trip_update.trip.start_date): item.trip_update
            for item in feed.entity if item.HasField("trip_update")}, stamp


def predicted(update, stop, seq, scheduled):
    if update is None:
        return scheduled, False
    if update.trip.schedule_relationship in (3, 7):  # Canceled or deleted.
        return None, False
    for call in update.stop_time_update:
        matches = call.stop_sequence == seq if call.HasField("stop_sequence") else call.stop_id == stop
        if not matches:
            continue
        if call.schedule_relationship == 1:  # Skipped.
            return None, False
        if call.schedule_relationship == 2 or not call.HasField("departure"):
            break
        event = call.departure
        if event.HasField("time"):
            return event.time, True
        if event.HasField("delay"):
            return scheduled + event.delay, True
    return scheduled, False


def live_rail(options, now):
    if not INDEX.is_file():
        raise ProviderError("Rail timetable missing. Run python -m rail to install it.")
    local = datetime.fromtimestamp(now, BRISBANE)
    midnight = local.replace(hour=0, minute=0, second=0, microsecond=0)
    updates, stamp = get_updates(now)
    departures = []
    with closing(sqlite3.connect(INDEX)) as db:
        origin = station_ids(db, options["origin"])
        destination = station_ids(db, options["destination"]) if options["destination"].strip() else []
        query = """
            SELECT c.trip,c.stop,c.seq,c.departure,t.service,t.headsign,s.platform
            FROM calls c JOIN trips t ON t.id=c.trip JOIN stops s ON s.id=c.stop
            WHERE c.pickup='0' AND c.stop IN ({}) AND c.departure BETWEEN ? AND ?
        """.format(",".join("?" for _ in origin))
        if destination:
            query += """
                AND EXISTS (SELECT 1 FROM calls d WHERE d.trip=c.trip AND d.seq>c.seq
                  AND d.dropoff='0' AND d.stop IN ({}))
            """.format(",".join("?" for _ in destination))

        covered = False
        for shift in (-1, 0, 1):
            start = midnight + timedelta(days=shift)
            day = start.strftime("%Y%m%d")
            base = start.timestamp()
            if base > now + 21600 or base + 172800 < now:
                continue
            active = {row[0] for row in db.execute("""
                SELECT service FROM calendar WHERE first<=? AND last>=? AND substr(weekdays,?,1)='1'
            """, (day, day, start.weekday()+1))}
            for service, kind in db.execute("SELECT service,kind FROM exceptions WHERE day=?", (day,)):
                if kind == "1":
                    active.add(service)
                else:
                    active.discard(service)
            covered |= bool(active)
            params = [*origin, now - base - 3600, now - base + 21600, *destination]
            for trip, stop, seq, departure, service, headsign, platform in db.execute(query, params):
                if service not in active:
                    continue
                at, prediction = predicted(updates.get((trip, day), updates.get((trip, ""))),
                                           stop, seq, base + departure)
                if at is not None and now < at <= now + 21600:
                    departures.append(dict(at=at, platform=platform or None, headsign=headsign,
                                           prediction=prediction, prediction_at=stamp if prediction else None))
    if not covered:
        raise ProviderError("Rail timetable does not cover today. Refresh it with python -m rail.")
    return sorted(departures, key=lambda row: row["at"])[:20], stamp


def main():
    parser = argparse.ArgumentParser(description="Refresh Pharos's local Translink rail timetable.")
    parser.add_argument("--zip", type=Path, help="Import an already downloaded official GTFS ZIP")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(dir=INDEX.parent) as directory:
        target = Path(directory) / "index.sqlite3"
        source = args.zip or Path(directory) / "schedule.zip"
        if not args.zip:
            with urlopen(SCHEDULE_URL, timeout=30) as response, source.open("wb") as file:
                shutil.copyfileobj(response, file)
        build_index(source, target)
        target.replace(INDEX)
    print("Translink rail timetable ready.")


if __name__ == "__main__":
    main()
