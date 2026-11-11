"""NASA wallpapers downloaded once and served locally."""
import hashlib
import html
import os
import re
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import urlopen
from zoneinfo import ZoneInfo

from providers import ProviderError, get_json

DIRECTORY = Path(__file__).with_name("data") / "wallpapers"
DIRECTORY.mkdir(parents=True, exist_ok=True)


def plain(value):
    return html.unescape(re.sub("<[^>]*>", "", str(value or "")))


def fetch_wallpaper(options, now):
    collection = options["collection"]
    if collection == "daily":
        date = datetime.fromtimestamp(now, ZoneInfo("America/New_York")).date()
        data = get_json("https://science.nasa.gov/wp-json/wp/v2/apod-basic/",
                        provider="NASA", api_key=os.getenv("NASA_API_KEY", "DEMO_KEY"),
                        start_date=date-timedelta(days=7), end_date=date)
        items = data if isinstance(data, list) else [data]
        images = sorted((item for item in items if item.get("media_type") == "image" and item.get("hdurl")),
                        key=lambda item: item.get("date", ""), reverse=True)
        if not images:
            raise ProviderError("NASA has no recent image. Keeping the last wallpaper.")
        item = images[0]
        url = item["hdurl"]
        source = item.get("permalink", "https://science.nasa.gov/apod/")
        title, credit = plain(item["title"]), plain(item.get("credit") or item.get("copyright") or "NASA")
        date = item.get("date", "")
    else:
        query = {"nebula": "nebula", "earth": "earth from space", "planets": "Saturn"}[collection]
        data = get_json("https://images-api.nasa.gov/search", provider="NASA",
                        q=query, media_type="image", page_size=1)
        items = data["collection"]["items"]
        if not items:
            raise ProviderError("NASA returned no images for this collection.")
        item = items[0]
        info = item["data"][0]
        links = [link for link in item.get("links", []) if link.get("render") == "image"]
        image = next((link for link in links if link.get("width") == 1280),
                     next((link for link in links if link.get("rel") == "preview"), None))
        if not image:
            raise ProviderError("NASA has no suitable preview.")
        url = image["href"]
        title, credit = plain(info["title"]), plain(info.get("photographer") or info.get("center") or "NASA")
        source = "https://images.nasa.gov/details/" + info["nasa_id"]
        date = info.get("date_created", "")[:10]

    parts = urlsplit(url)
    allowed = {"assets.science.nasa.gov", "images-assets.nasa.gov", "apod.nasa.gov"}
    if parts.scheme != "https" or parts.hostname not in allowed:
        raise ProviderError("NASA image host is unavailable. Keeping the last wallpaper.")
    if parts.hostname == "assets.science.nasa.gov" and parts.path.startswith("/dynamicimage/"):
        params = dict(parse_qsl(parts.query))
        params.update(w="1280", h="720", fit="clip")
        url = urlunsplit(parts._replace(query=urlencode(params)))
    with urlopen(url, timeout=6) as response:
        mime = response.headers.get_content_type()
        if mime not in ("image/jpeg", "image/png", "image/webp"):
            raise ProviderError("NASA did not return a supported still image.")
        content = response.read(5_000_001)
    if len(content) > 5_000_000:
        raise ProviderError("NASA image is too large for the wallpaper cache.")
    extension = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[mime]
    name = hashlib.sha256(content).hexdigest()[:24]+extension
    target = DIRECTORY / name
    if not target.exists():
        with tempfile.NamedTemporaryFile(dir=DIRECTORY, suffix=".tmp", delete=False) as file:
            temporary = Path(file.name)
            file.write(content)
        try:
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
    return dict(url="/wallpapers/"+name, title=title, credit=credit,
                source=source, date=date, collection=collection), None
