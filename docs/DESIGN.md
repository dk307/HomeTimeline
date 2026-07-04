# Camera Event Manager — Architecture Design

> Last updated: 2026-07-03
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
| Python | 3.13 | Current stable. Better errors, ~5% perf gain over 3.12 |
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
│   │   ├── log_buffer.py            # In-memory ring buffer for Activity UI
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
│   │   │   └── VideoPlayer/         # HTML5 video with Range streaming
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
│   └── Dockerfile                   # Multi-stage: node:22-slim build → python:3.13-slim serve
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
    camera_type    = CharField(default="generic")  # "generic" | "hikvision"
    location       = ForeignKeyField(Location, backref="cameras", null=True)
    recording_path = CharField()
    enabled        = BooleanField(default=True)
    display_order  = IntegerField(default=0)
    clip_strategy  = CharField(default="daily_folder")  # per-day folders, time from file end
    scan_interval_minutes = IntegerField(null=True)  # None = Never (manual only)
    # Hikvision-only connection + download settings:
    host           = CharField(null=True)
    username       = CharField(null=True)
    password       = CharField(null=True)   # plaintext; never returned by the API
    download_interval_minutes = IntegerField(null=True)  # None = Never (manual only)
    last_downloaded_at = DateTimeField(null=True)
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
  POST   /api/v1/cameras/{id}/download        manual Hikvision download (400 if generic)
  GET    /api/v1/cameras/{id}/download-status running + last downloaded
  GET    /api/v1/cameras/{id}/download-events per-camera download history
  GET    /api/v1/cameras/{id}/device-info     live Hikvision device info + RTSP/snapshot URLs

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
  GET    /api/v1/activity                  recent scan events (TZ-aware timestamps)

Logs
  GET    /api/v1/logs                      recent log entries (TZ-aware timestamps)

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
- Derives timestamps via the per-camera **Clip Storage Strategy** (`clip_strategy`, currently
  only `daily_folder`): clip end time = file mtime, start = end − duration
- Uses a **per-camera** `threading.Lock` registry so the same camera never scans concurrently,
  while different cameras scan in parallel
- Returns `(added: int, skipped: int)` per camera; builds a detail string for the activity log

## 8a. Downloader (Hikvision)

`app/services/downloader.py` + `app/services/hikvision.py`:

- Applies only to `camera_type == "hikvision"` cameras with a stored host/username/password
- `HikvisionClient` (async `aiohttp`, ISAPI): `search_all_recordings` pages the whole catalog via
  `POST /ISAPI/ContentMgmt/search`; `download_clip` streams each clip from
  `GET /ISAPI/ContentMgmt/download`; `get_device_info` reads `/ISAPI/System/deviceInfo`
- `download_camera` writes clips into `recording_path/<YYYY-MM-DD>/<name>.mp4` (day = clip start
  local day, `<name>` from the playback URI), sets mtime = clip end time, and **skips files that
  already exist** (the dedup — no incremental watermark). Then it reuses `scanner.scan_camera`
  to index the new files (thumbnails, probe, dedup)
- Mirrors the scanner's **per-camera lock** registry (`is_downloading`, `_acquire_download_lock`);
  each run records a `DownloadEvent`. A per-camera `download_interval_minutes` (None = Never)
  drives an APScheduler job parallel to the scan job
- The synchronous entry point drives the async client via `asyncio.run` on a worker thread

---

## 9. Testing

```
tests/unit/           Pure unit tests (all I/O mocked) — 156 tests total
tests/integration/    Real SQLite in-memory + httpx test client
tests/e2e/            Playwright — requires running container
```

`conftest.py` for E2E is minimal — `--base-url` and `base_url` fixture are provided by pytest-playwright; no redefinition needed.

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
FROM python:3.13-slim
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

Credentials stored in `.private/ssh.txt` (gitignored): line 1 = `user@host`, line 2 = password.

```bash
# Build on server
podman build --no-cache -f docker/Dockerfile -t camera-event-manager:latest .

# Run
podman run -d --name camera-event-manager \
  -p 8080:8080 \
  -v /opt/camera-event-manager/data:/app/data \
  -v /nas/camera:/nas/camera:ro \
  -e SCAN_INTERVAL_MINUTES=5 \
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

---

## 13. Phase Extension Map

| Phase | What's added |
|---|---|
| 2 — Events | `Event` model, categories, event/recording join; timeline items extended |
| 3 — Camera Mgmt | Live view (HLS via go2rtc), snapshot, reboot |
| 4 — Recording Mgmt | Tags, notes, favorites, bulk ops |
| 5 — Storage Mgmt | Retention policies, auto-cleanup |
| 6 — External Integration | Webhooks, inbound recording/event API, Home Assistant |
| 7/8 — AI | `AIAnnotation` model, confidence scores, canvas overlays |
