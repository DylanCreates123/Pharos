# Project Pharos v0.1

A local touchscreen dashboard for a desk. Designed for Chromium on a Raspberry Pi 3B with a 7-inch landscape screen. The browser uses plain HTML, CSS and JavaScript. The local FastAPI server serves the app and caches provider data in SQLite.

## Run from VS Code on Windows

Open this folder in VS Code. In its PowerShell terminal, run:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8765
```

Open [Pharos on localhost](http://127.0.0.1:8765). After installing dependencies, you can also run **Tasks: Run Task → Run Pharos** in VS Code.

## Raspberry Pi OS

With Python 3.10 or newer and venv support installed:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 8765
```

Once the server is up, launch the installed Chromium binary with `chromium --kiosk http://127.0.0.1:8765`. Keep the server in a single process so provider-wide cooldowns apply to all clients. Installation needs access to Python packages. The running demo needs only loopback. Use the same browser profile and URL to keep timers, assessments and settings. To move the server cache, set `PHAROS_CACHE` to a writable SQLite file path before starting.

## Layers

- **Information.** `providers.py` produces deterministic weather, departure and NBA samples. `app.py` owns normalized cache records, SQLite persistence, deduplication, cooldowns, timeouts and retry timing. Provider failures can carry a `retry_after` delay in seconds. Browser-local timers and assessments are managed by `web/local.js`.
- **Coordination.** `web/config.js` contains the default settings and screen requirements. `web/coordinator.js` shares data by provider and filter, applies visibility and refresh policies, and retains recent results in browser storage. The browser can reopen the cached shell after a successful first visit even if the local server is down.
- **Visual.** `web/ui.js` mounts the requested view, renders data and handles touch or keyboard actions. Clock and timer values use timestamps and do not request data.

## Sample settings and integrations

| Setting | Default |
| --- | --- |
| Weather location | Brisbane |
| Timezone | Australia/Brisbane |
| Transport | Wooloowin, any destination until configured |
| NBA favourite team | All teams |
| Provider mode | Demo |
| Weather / Home departures / Transport detail / NBA | 900 / 300 / 60 / 1800 seconds |

Weather supports Open-Meteo live forecasts for personal non-commercial use without an account or API key. In Settings, keep **Default provider mode** on **demo** and set **Weather provider** to **live** to try it independently. The Pi needs internet access for live weather. Train and NBA providers can also be switched independently between demo and live. Assessments are entered locally and timers are local. Settings also provides a UTC demo clock override for reproducible examples. There is no timer sound in v0.1.

### Translink trains

Run `python -m rail` with the virtual environment interpreter to download the official SEQ timetable and build a local rail index. Run it again when the timetable expires or to pick up a new release. In Settings, set **Train provider** to **live**. Enter an optional destination such as Central to show only direct trains that call there after the origin. No account or key is needed. Train detail combines the local timetable with Translink rail trip updates. When a fresh prediction is unavailable, times are labelled Scheduled. Attribution and the feed licence are available on the [Translink open data page](https://translink.com.au/about-translink/open-data).

### NBA schedule and results

Get a key from [BALLDONTLIE](https://docs.balldontlie.io/) and set the server environment variable `BALLDONTLIE_API_KEY`. For PowerShell, run `$env:BALLDONTLIE_API_KEY = Read-Host -MaskInput 'BALLDONTLIE key'` in PowerShell 7, then launch Uvicorn from the same terminal. On the Pi, export the variable in the shell or provide it through the service environment before starting Pharos. Set **NBA provider** to **live** in Settings. An optional three-letter team code filters the games. Keep the key out of source files and Git. NBA requests were checked with mocked API responses pending an account key.

## Verification

Run `python -m unittest -v` with the virtual environment interpreter and `node --test coordinator.test.mjs` with Node 22+. Node is only used for development tests. Raspberry Pi OS installation, kiosk startup, physical touch behavior and sustained performance on the Pi 3B need hardware validation.

Desktop Chrome was checked at 1280 × 720 for Home layout, navigation, timer creation and reload, assessment entry, cache reuse and an offline reload after first use. The automated tests use fake clocks and counting providers for demand, refresh cadence, visibility, deduplication, cooldowns, retry timing and cache persistence.

### Screen layout rule

At 1280 × 720, information screens should keep their headings, primary data and controls within one viewport. Group related information into cards and use paging for lists that can exceed the available space.
