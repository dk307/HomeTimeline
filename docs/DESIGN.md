# Camera Event Manager — Architecture Design

> Last updated: 2026-07-08
> Status: Phase 1 complete and deployed

---

## 1. Guiding Principles

- Event-driven, timeline-first UX
- Lightweight self-hosted deployment — no external services required
- Modular so future phases add on without rearchitecting
- AI writes all code (vibe-coded); deployed to a dedicated Linux SSH server

---

## 2. Final Technology Stack

### Summary table

| Layer | Choice | Rationale |
|---|---|---|
| Python | 3.14 | Current stable. New tail-call interpreter (~free perf gain), improved asyncio introspection & error messages |
| Web framework | FastAPI + uvicorn | Async, Pydantic built-in, auto OpenAPI docs |
| ORM | Peewee + playhouse | Used by Frigate (reference NVR). Simpler than SQLAlchemy for this domain |
| Migrations | peewee-migrate | Native Peewee fit, no Alembic overhead |
| Database | SQLite (WAL mode) | Zero services, handles 100k+ recordings, one line to swap to Postgres |
| Video / thumbnails | ffmpeg-python | Thin wrapper over ffmpeg binary — no custom codec logic |
| Filesystem watcher | watchdog | inotify on Linux — instant new-recording detection, no polling |
| Scheduler | APScheduler | In-process, no Redis/Celery needed |
| Frontend framework | React 18 + TypeScript + Vite | Richest ecosystem for timeline, video, live view, AI overlays |
| Component library | shadcn/ui | Accessible, themeable, copied into project — no black box |
| Styling | Tailwind CSS v4 | Utility-first |
| Server state | TanStack Query | Caching, loading/error states for every API call |
| Client state | Zustand | Selected date, active camera, playback position |
| Routing | React Router v7 | Client-side SPA routing |
| Video player | HTML5 Range streaming | 206 Partial Content served directly from FastAPI |
| Charts | Recharts | Storage stats on dashboard |
| Date handling | date-fns + Intl.DateTimeFormat | Day navigation, range formatting, timezone-aware display |
| Config | pydantic-settings | .env file + environment variables |
| Testing — unit/integration | pytest + httpx + pytest-mock + freezegun | Fast, no I/O required |
| Testing — E2E | Playwright + pytest-playwright | Headless; browser tests require display server |
| Container runtime | Podman | Server has Podman. Rootless, daemonless, Docker-compatible |

**Python 3.14 baseline.** `requires-python = ">=3.14"`. The interpreter upgrade is a
drop-in performance win (the new tail-call interpreter needs no code change), and the
code is written 3.14-native: PEP 758 parenthesis-less `except A, B:`, PEP 649 deferred
annotations (no forward-ref string quotes), and `datetime.UTC`. Linters targeting an
older Python may flag these as errors — that is a tooling false positive; `ruff` is
configured for 3.14 and is the source of truth.

---

## 3. Prior Art

Frigate (leading open-source NVR in Python) informed several choices:

- **Peewee** over SQLAlchemy — Frigate uses it in production with hundreds of thousands of recordings
- **FastAPI + uvicorn** — same stack
- **Playwright** for E2E tests
- **ffmpeg** for all video operations — universal standard

---

## 4. Project Structure

```
HomeTimeline/
├── app/                             # FastAPI backend
│   ├── main.py                      # App factory, lifespan, mounts frontend/dist
│   ├── config.py                    # pydantic-settings Settings
│   ├── database.py                  # Peewee DB init, WAL pragmas, model registry, migrations
│   ├── models/
│   │   ├── location.py
│   │   ├── camera.py
│   │   ├── recording.py
│   │   ├── scan_event.py
│   │   └── app_settings.py          # Singleton settings row (timezone)
│   ├── schemas/                     # Pydantic request/response shapes
│   │   ├── location.py
│   │   ├── camera.py
│   │   ├── recording.py
│   │   └── app_settings.py
│   ├── api/                         # FastAPI routers
│   │   ├── cameras.py
│   │   ├── locations.py
│   │   ├── recordings.py
│   │   ├── timeline.py
│   │   ├── scanner.py
│   │   ├── storage.py
│   │   ├── activity.py
│   │   ├── logs.py
│   │   ├── app_settings.py          # GET/PATCH /api/v1/settings
│   │   └── health.py
│   ├── services/                    # Business logic — no HTTP concerns
│   │   ├── scanner.py               # File discovery, import, dedup; threading.Lock guard
│   │   ├── thumbnail.py             # ffmpeg frame extraction
│   │   ├── health.py                # Missing/duplicate/corrupt detection
│   │   ├── storage.py               # shutil.disk_usage stats
│   │   ├── log_buffer.py            # In-memory ring buffer for Logs UI; seeded from the
│   │   │                            #   persisted log file on startup so history survives restarts
│   │   └── tz.py                    # Timezone detection, UTC→app-tz conversion, fmt_dt()
│   └── workers/
│       └── scheduler.py             # APScheduler jobs — one per camera (per-camera interval)
│
├── frontend/                        # React app
│   ├── src/
│   │   ├── index.css                # Tailwind + shadcn/ui CSS variables (incl. --popover)
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── hooks/
│   │   │   └── useTimezone.ts       # Reads app timezone from settings query cache
│   │   ├── lib/
│   │   │   └── tz.ts                # fmtDt(), FMT_DATETIME, FMT_DATETIME_SHORT, fmtRelative()
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Live.tsx             # Multi-camera live wall (NVR grid, persisted layout)
│   │   │   ├── Timeline.tsx         # Custom CSS grid timeline + DatePicker portal
│   │   │   ├── Recordings.tsx       # Sortable table + DateRangePicker portal
│   │   │   ├── Activity.tsx         # Scan log + activity feed (TZ-aware timestamps)
│   │   │   ├── Logs.tsx             # Live log stream (TZ-aware timestamps)
│   │   │   └── settings/
│   │   │       ├── General.tsx      # Scan interval + timezone dropdown
│   │   │       ├── Cameras.tsx
│   │   │       └── Locations.tsx
│   │   ├── components/
│   │   │   ├── ui/                  # shadcn/ui copied components
│   │   │   └── VideoPlayer/         # HTML5 video with Range streaming + prev/next clip nav (← / →)
│   │   ├── api/                     # TanStack Query fetch functions
│   │   │   ├── cameras.ts
│   │   │   ├── recordings.ts
│   │   │   ├── settings.ts          # AppSettings interface incl. timezone
│   │   │   └── timeline.ts
│   │   └── store/
│   │       └── ui.ts                # Zustand — selectedDate, selectedRecordingId
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
│
├── tests/
│   ├── conftest.py
│   ├── unit/
│   │   ├── test_tz.py               # timezone detection + conversion unit tests
│   │   └── test_storage.py
│   ├── integration/
│   │   ├── test_app_settings_api.py # timezone GET/PATCH + validation tests
│   │   └── …
│   └── e2e/
│       └── conftest.py              # base_url provided by pytest-playwright (no redefinition)
│
├── docker/
│   └── Dockerfile                   # Multi-stage: node:22-slim build → python:3.14-slim serve
│
└── docs/
    ├── DESIGN.md
    └── product_requirements.md
```

---

## 5. Data Models (Peewee)

```python
class Location(BaseModel):
    id            = AutoField()
    name          = CharField(unique=True)
    description   = TextField(null=True)
    created_at    = DateTimeField(default=datetime.now)

class Camera(BaseModel):
    id             = AutoField()
    name           = CharField()
    description    = TextField(null=True)
    camera_type    = CharField(default="generic")  # "generic" | "hikvision" | "aqura"
    location       = ForeignKeyField(Location, backref="cameras", null=True)
    recording_path = CharField()
    enabled        = BooleanField(default=True)
    display_order  = IntegerField(default=0)
    clip_strategy  = CharField(default="daily_folder")
                   # "daily_folder" | "aqura_nas_upload"
                   # daily_folder: per-day YYYY-MM-DD folders, time from file end
                   # aqura_nas_upload: per-day YYYYMMDD folders, same scanner logic
    scan_interval_minutes = IntegerField(null=True)  # None = Never (manual only)
    # Hikvision-only connection + download settings:
    host           = CharField(null=True)
    username       = CharField(null=True)
    password       = CharField(null=True)   # plaintext; never returned by the API
    download_interval_minutes = IntegerField(null=True)  # None = Never (manual only)
    last_downloaded_at = DateTimeField(null=True)
    # Hikvision-only purge settings (delete old clips):
    purge_older_than_days = IntegerField(null=True)      # None = Never (keep everything)
    purge_interval_minutes = IntegerField(null=True)     # None = Never (manual only)
    last_purged_at = DateTimeField(null=True)
    # Aqura-specific: 3 user-entered RTSP stream URLs + RTSP credentials.
    stream_url_1   = CharField(null=True)
    stream_url_2   = CharField(null=True)
    stream_url_3   = CharField(null=True)
    aqura_username = CharField(null=True)
    aqura_password = CharField(null=True)   # plaintext; never returned by the API
    created_at     = DateTimeField(default=datetime.now)
    updated_at     = DateTimeField(default=datetime.now)

class Recording(BaseModel):
    id              = AutoField()
    camera          = ForeignKeyField(Camera, backref="recordings")
    file_path       = CharField(unique=True)
    file_hash       = CharField(null=True, index=True)   # SHA-256 first 64KB, dedup
    start_time      = DateTimeField(index=True)
    end_time        = DateTimeField(null=True)
    duration_secs   = FloatField(null=True)
    file_size_bytes = BigIntegerField(null=True)
    thumbnail_path  = CharField(null=True)
    status          = CharField(default="pending")  # pending | ready | error
    created_at      = DateTimeField(default=datetime.now)
    updated_at      = DateTimeField(default=datetime.now)

class DownloadEvent(BaseModel):
    """Per-camera history of a Hikvision download run."""
    id           = AutoField()
    camera       = ForeignKeyField(Camera, backref="download_events", on_delete="CASCADE")
    started_at   = DateTimeField(default=datetime.utcnow)
    finished_at  = DateTimeField(null=True)
    downloaded   = IntegerField(default=0)   # clips fetched from the camera
    indexed      = IntegerField(default=0)   # new recordings indexed afterwards
    status       = TextField(default="ok")   # ok | error
    detail       = TextField(null=True)

class PurgeEvent(BaseModel):
    """Per-camera history of a purge run (deletes old clips)."""
    id           = AutoField()
    camera       = ForeignKeyField(Camera, backref="purge_events", on_delete="CASCADE")
    started_at   = DateTimeField(default=datetime.utcnow)
    finished_at  = DateTimeField(null=True)
    deleted      = IntegerField(default=0)      # clips removed (file + index + thumbnail)
    freed_bytes  = BigIntegerField(default=0)   # disk space reclaimed
    status       = TextField(default="ok")      # ok | error
    detail       = TextField(null=True)

class AppSettings(BaseModel):
    """Singleton row — always ID=1. Use AppSettings.get_instance()."""
    id                   = AutoField()
    timezone             = CharField(default="UTC")  # IANA tz name, e.g. "America/New_York"
    created_at           = DateTimeField(default=datetime.now)
    updated_at           = DateTimeField(default=datetime.now)
```

**SQLite pragmas at startup:**
```python
{"journal_mode": "wal", "cache_size": -64000, "synchronous": "NORMAL", "foreign_keys": 1}
```

**Migration strategy:** `database.py::_migrate()` runs at startup after `db.create_tables()` and before any model queries. It uses `PRAGMA table_info()` to detect missing columns and issues `ALTER TABLE … ADD COLUMN` for each. This is idempotent and safe on existing databases.

---

## 6. API Surface

All JSON routes: `/api/v1/`. React SPA served at all other routes from `frontend/dist`.

```
Cameras
  GET    /api/v1/cameras                   list (?location_id, ?enabled)
  POST   /api/v1/cameras                   create
  GET    /api/v1/cameras/{id}              get
  PUT    /api/v1/cameras/{id}              update
  DELETE /api/v1/cameras/{id}              delete
  GET    /api/v1/cameras/{id}/stats        totals, last video, last downloaded
  POST   /api/v1/cameras/{id}/scan         manual scan (non-destructive)
  POST   /api/v1/cameras/{id}/reindex      drop index + rescan
  DELETE /api/v1/cameras/{id}/recordings   drop index only
  POST   /api/v1/cameras/{id}/download        manual Hikvision download (400 if generic/aqura)
  POST   /api/v1/cameras/{id}/download/stop   request the running download to stop
  GET    /api/v1/cameras/{id}/download-status running + last downloaded
  GET    /api/v1/cameras/{id}/download-events per-camera download history
  POST   /api/v1/cameras/{id}/purge           manual purge of old clips (400 if generic/aqura /
                                              no retention set)
  POST   /api/v1/cameras/{id}/purge/stop      request the running purge to stop
  GET    /api/v1/cameras/{id}/purge-status    running + last purged
  GET    /api/v1/cameras/{id}/device-info     live Hikvision device info + RTSP/snapshot URLs
                                              (400 if not Hikvision)
  GET    /api/v1/cameras/{id}/streams         register + list live-view streams (Hikvision:
                                              main+sub; Aqura: 3 channels; 400 if generic)

Locations
  GET    /api/v1/locations                 list
  POST   /api/v1/locations                 create
  PUT    /api/v1/locations/{id}            update
  DELETE /api/v1/locations/{id}            delete

Recordings
  GET    /api/v1/recordings                list (?camera_id, ?date, ?days)
  GET    /api/v1/recordings/{id}           get with metadata
  DELETE /api/v1/recordings/{id}           delete file + DB row
  GET    /api/v1/recordings/{id}/stream    video (Range header → 206 Partial Content)
  GET    /api/v1/recordings/{id}/download  file download

Timeline
  GET    /api/v1/timeline?date=YYYY-MM-DD&days=N   segments per camera for the grid

Scanner
  POST   /api/v1/scanner/scan              trigger manual rescan (BackgroundTasks)
  GET    /api/v1/scanner/status            last_scan, is_running, last_result

Storage
  GET    /api/v1/storage/stats             total_recordings, used_bytes, free_bytes

Settings
  GET    /api/v1/settings                  { timezone }
  PATCH  /api/v1/settings                  update (validates IANA timezone via zoneinfo)
                                           (per-camera scan schedule lives on the camera:
                                            Camera.scan_interval_minutes, null = Never)

Activity
  GET    /api/v1/activity                  recent scan + download + purge events,
                                           merged newest-first (TZ-aware timestamps).
                                           status ∈ {ok, error, interrupted}; "interrupted"
                                           is set on startup for runs left open by an
                                           unclean shutdown (see reconcile below).

Logs
  GET    /api/v1/logs                      recent log entries (TZ-aware timestamps).
                                           The in-memory buffer is re-seeded from the persisted
                                           log file (UTC timestamps) at startup, so a restart
                                           doesn't present an empty Logs page.

Health
  GET    /api/v1/health                   liveness probe + DB check
  GET    /api/v1/health/recordings         corrupted, duplicate_paths, orphaned counts
```

---

## 7. Frontend Architecture

### Production serving

FastAPI serves the React build as static files. No Node runtime in production.

```python
app.mount("/assets", StaticFiles(directory="frontend/dist/assets"))

@app.get("/{full_path:path}")
async def spa(full_path: str):
    return FileResponse("frontend/dist/index.html")
```

### Timezone architecture

All datetimes are stored as UTC-naive in SQLite. At API response time, `app/services/tz.py` converts them to the configured IANA timezone using Python's `zoneinfo` module (stdlib, Python 3.9+).

```
DB (UTC-naive) → tz.to_app_tz() → ISO string with offset → JSON response
                                                               ↓
                                                    Frontend: new Date(iso)
                                                    Display:  fmtDt(date, tz, opts)
                                                              (Intl.DateTimeFormat)
```

The configured timezone is read by the `useTimezone()` React hook, which piggybacks on the `["app-settings"]` TanStack Query cache (5-minute stale time). All timestamp-displaying components call `useTimezone()` and pass `tz` to `fmtDt()`.

### Date picker pattern

Both Timeline and Recordings use a Grafana-style compact trigger button that opens a popover. Key implementation details:

- Popup rendered via `ReactDOM.createPortal(…, document.body)` — avoids stacking context issues from `overflow-auto` scroll containers and `overflow-hidden` + `border-radius` compositing layers
- Position captured with `getBoundingClientRect()` on open, stored as `position: fixed` coordinates
- Outside-click handled with `document.addEventListener("mousedown", …)` in a `useEffect`
- Popup uses `z-[200]` to reliably beat sticky timeline headers (`z-10`)
- Outer timeline/recordings card uses no `overflow-hidden` at the card level; `overflow-hidden` lives only on the inner scroll container to avoid compositor traps for fixed children

### CSS variables

`index.css` defines the full shadcn/ui token set including `--popover` and `--popover-foreground` for both light and dark themes. All popup backgrounds use `bg-popover`.

### Timeline widget

Custom CSS grid implementation (not react-calendar-timeline). Cameras as rows, time as columns, recording segments as absolutely-positioned buttons within percentage-width cells. Tick labels use `date-fns format()` for grid reference lines (local browser time); recording segment positions use UTC-offset ISO strings from the API so placement is always accurate regardless of timezone.

---

## 8. Scanner

`app/services/scanner.py`:

- Walks configured camera recording paths; imports files matching video extensions
- Deduplicates by SHA-256 of first 64KB (`file_hash`)
- Derives timestamps via the per-camera **Clip Storage Strategy** (`clip_strategy`):
  - `daily_folder` (default): clip end time = file mtime, start = end − duration
  - `aqura_nas_upload`: probes embedded `creation_time` metadata tag first (via ffprobe);
    if the tag is present it is used as the clip end time. Falls back to `st_mtime`
    only when no metadata is found. The `YYYYMMDD` folder format is a NAS naming
    convention; the scanner always scans recursively regardless of folder structure.
- Uses a **per-camera** `threading.Lock` registry so the same camera never scans concurrently,
  while different cameras scan in parallel
- Returns `(added: int, skipped: int)` per camera; builds a detail string for the activity log

## 8a. Downloader (Hikvision only)

`app/services/downloader.py` + `app/services/hikvision.py`:

- Applies only to `camera_type == "hikvision"` cameras with a stored host/username/password
  (Aqura and generic cameras are skipped — scan-only)
- `HikvisionClient` (async `aiohttp`, ISAPI): `search_all_recordings` pages the whole catalog via
  `POST /ISAPI/ContentMgmt/search`; `download_clip` streams each clip from
  `GET /ISAPI/ContentMgmt/download`; `get_device_info` reads `/ISAPI/System/deviceInfo`
- Authenticates with a pre-encoded HTTP Basic header via `aiohttp.encode_basic_auth()`
  (not the deprecated `auth=`/`BasicAuth` session argument) — this requires **`aiohttp>=3.14`**
- `download_camera` writes clips into `recording_path/<YYYY-MM-DD>/<name>.mp4` (day = clip start
  local day, `<name>` from the playback URI). After the stream completes:
  `set_file_times` sets atime=clip start, mtime=clip end; `set_mp4_metadata` writes embedded
  tags (`creation_time`, title, artist, track, comment, encoder) via `ffmpeg -c copy`.
  **Skips files that already exist** (the dedup — no incremental watermark). Then it reuses
  `scanner.scan_camera` to index the new files (thumbnails, probe, dedup)
- Mirrors the scanner's **per-camera lock** registry (`is_downloading`, `_acquire_download_lock`);
  each run records a `DownloadEvent`. A per-camera `download_interval_minutes` (None = Never)
  drives an APScheduler job parallel to the scan job
- The synchronous entry point drives the async client via `asyncio.run` on a worker thread

## 8a-bis. Purger (delete old clips — Hikvision only)

`app/services/purger.py`:

- Applies to `camera_type == "hikvision"` cameras with a retention window
  (`purge_older_than_days`, None = Never → nothing is deleted).
  Aqura and generic cameras have no purge capability.
- `purge_camera` selects recordings whose `start_time` is older than
  `utcnow() − purge_older_than_days` and, for each, deletes the **video file, its
  thumbnail, and the index row**, tallying reclaimed bytes. Comparison uses a naive-UTC
  cutoff to match the storage convention
- `_delete_file` returns `(gone, freed_bytes)`: a **genuine `unlink()` failure**
  (e.g. permissions) leaves the row **retained** so the clip isn't orphaned on disk;
  an already-missing file still drops the row
- Mirrors the downloader's **per-camera lock** registry (`is_purging`,
  `_acquire_purge_lock`) and cooperative stop (`request_purge_stop`, checked between
  clips). Each run records a `PurgeEvent`. A per-camera `purge_interval_minutes`
  (None = Never) drives its own APScheduler job

## 8a-bis. Event reconciliation (startup)

`app/services/reconcile.py`:

- Every scan / download / purge writes its event row with `finished_at = NULL` at the
  start and fills in the outcome when done. If the process dies mid-run (typically a
  **container restart**), that row is orphaned — `finished_at` stays NULL and `status`
  keeps its `"ok"` default, so Activity would show it running forever.
- `reconcile_interrupted_events()` runs once in the lifespan **after `init_db()` and
  before `start_scheduler()`** (so no genuine in-progress run can be misclassified). It
  updates every event with `finished_at IS NULL` to `status="interrupted"`,
  `finished_at=now`, with an explanatory `detail`. The Activity UI renders that state
  with an amber marker.

---

## 8b. Live view (go2rtc / WebRTC)

`app/services/go2rtc.py`:

- Live camera video uses **go2rtc**, a tiny static Go binary **bundled into the image** and run as
  a child process from the app lifespan (Frigate-style) — the single-container deploy is unchanged.
  It listens on localhost for its API/MSE and on a published TCP port (`8555`) for WebRTC.
- Streams are registered **dynamically** via go2rtc's REST API (`PUT /api/streams`) from the RTSP URL
  built out of each camera's stored credentials:
  - **Hikvision**: two per camera — `cam<id>_main` (channel 101, HD) and `cam<id>_sub`
    (channel 102, SD). Credentials are the Hikvision host/username/password.
  - **Aqura**: three per camera — `cam<id>_1`, `cam<id>_2`, `cam<id>_3` from the user-configured
    stream URLs. Credentials are the Aqura-specific `aqura_username`/`aqura_password` injected
    into the RTSP URL at registration time via the go2rtc REST API. All 3 streams get an ffmpeg
    H.264 transcode fallback (unknown codec). The `aqura_username` and `aqura_password` are
    never exposed to the frontend API — only `aqura_has_password` is returned.
- `GET /cameras/{id}/streams` registers the streams and returns their names/labels, or
  `{available: false, reason}` when live view isn't possible (generic camera, no host/URLs,
  go2rtc down).
- `WS /cameras/live/ws?src=<name>` proxies the go2rtc signaling WebSocket so the browser only talks
  to our origin; `src` is restricted to the `cam<id>_(main|sub|1|2|3)` names we manage.
- Frontend `VideoStream.tsx` negotiates **WebRTC** (media over the published `8555`, signaling over
  the proxied WS) and shows a graceful error + retry if negotiation fails. It takes optional
  `fill` / `controls` / `objectFit` props so the same player serves both the aspect-ratio camera-page
  view and the fill-the-cell wall tiles. The camera detail page is organized with the live view
  always on top, above **Timeline / Details / Commands** tabs, with a quality switch (main/sub
  for Hikvision, Channel1/2/3 for Aqura).
- The **Live View** page (`frontend/src/pages/Live.tsx`, route `/live`) is a multi-camera wall: it
  lists every live-capable camera (Hikvision + Aqura), renders one `VideoStream` tile per camera
  (each tile fetches its own `/cameras/{id}/streams`), and lays them out in an NVR-style CSS grid.
  A cameras-per-row control (**Auto / 1× / 2× / 3× / 4×**) is persisted to `localStorage`, and
  a global quality toggle defaults to the lighter sub stream for many concurrent feeds.
- Deploy passes `GO2RTC_WEBRTC_CANDIDATE=<host-ip>:8555` so go2rtc advertises a LAN-reachable
  candidate (a container can't auto-detect the host's address).

---

## 9. Testing

```
tests/unit/           Pure unit tests (all I/O mocked) — 156 tests total
tests/integration/    Real SQLite in-memory + httpx test client
tests/e2e/            Playwright — requires running container
```

`conftest.py` for E2E is minimal — `--base-url` and `base_url` fixture are provided by pytest-playwright; no redefinition needed.

### Local test setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
pytest tests/unit tests/integration -v
```

Do not `pip install --break-system-packages` — the venv must always be active when running tests locally. The `.venv/` directory is gitignored.

---

## 10. Dockerfile — Multi-stage Build

```dockerfile
# Stage 1: build React
FROM node:22-slim AS frontend
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# Stage 2: production Python image
FROM python:3.14-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=frontend /build/dist ./frontend/dist
COPY pyproject.toml .
RUN pip install --no-cache-dir ".[prod]"
COPY app/ ./app/

EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
```

---

## 11. Deployment

> **Critical requirement:** the `podman run` command **must** include both `-p 8555:8555` and `-v /nas/camera:/nas/camera`. Forgetting either breaks:
> - **Live view** (`-p 8555:8555` missing → WebRTC unreachable)
> - **Recording playback** (`-v /nas/camera:...` missing → all `/recordings/{id}/stream` return 404)

Credentials stored in `.private/ssh.txt` (gitignored): line 1 = `user@host`, line 2 = password.

```bash
# Build on server
podman build --no-cache -f docker/Dockerfile -t camera-event-manager:latest .

# Run — both ports AND both volume mounts are required
podman run -d --name camera-event-manager \
  -p 8080:8080 \
  -p 8555:8555 \
  -v /opt/camera-event-manager/data:/app/data \
  -v /nas/camera:/nas/camera \
  --env-file /opt/camera-event-manager/.env \
  -e GO2RTC_WEBRTC_CANDIDATE=192.168.1.164:8555 \
  camera-event-manager:latest
```

For Python-only or frontend-only changes, hot-patch without rebuilding:
```bash
# Backend file
podman cp changed.py camera-event-manager:/app/app/services/changed.py
# Frontend bundle
podman cp dist/assets/index-HASH.js camera-event-manager:/app/frontend/dist/assets/
podman restart camera-event-manager
```

---

## 12. Environment Variables

| Variable | Description |
|---|---|
| `SCAN_INTERVAL_MINUTES` | Legacy/unused — scanning is now scheduled per-camera (`Camera.scan_interval_minutes`) |
| `THUMBNAIL_DIR` | Where thumbnails are written |
| `DATABASE_URL` | SQLite file path |
| `RECORDING_LOCATIONS` | Colon-separated list of root recording directories |
| `LOG_FILE` | Log file path |
| `LOG_LEVEL` | Logging verbosity |
| `GO2RTC_ENABLED` | Enable the embedded go2rtc live-streaming process (default true) |
| `GO2RTC_WEBRTC_CANDIDATE` | `host-ip:8555` advertised to browsers for WebRTC (set by deploy) |

---

## 13. Phase Extension Map

| Phase | What's added |
|---|---|
| 2 — Events | `Event` model, categories, event/recording join; timeline items extended |
| 3 — Camera Mgmt | Live view (WebRTC via go2rtc) ✅, snapshot, reboot |
| 4 — Recording Mgmt | Tags, notes, favorites, bulk ops |
| 5 — Storage Mgmt | Retention policies, auto-cleanup |
| 6 — External Integration | Webhooks, inbound recording/event API, Home Assistant |
| 7/8 — AI | `AIAnnotation` model, confidence scores, canvas overlays |
