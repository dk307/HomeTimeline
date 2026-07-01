# Camera Event Manager — Architecture Design

> Last updated: 2026-06-29
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
| Date handling | date-fns | Day navigation, range formatting |
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
│   ├── database.py                  # Peewee DB init, WAL pragmas, model registry
│   ├── models/
│   │   ├── location.py
│   │   ├── camera.py
│   │   └── recording.py
│   ├── schemas/                     # Pydantic request/response shapes
│   │   ├── location.py
│   │   ├── camera.py
│   │   └── recording.py
│   ├── api/                         # FastAPI routers
│   │   ├── cameras.py
│   │   ├── locations.py
│   │   ├── recordings.py
│   │   ├── timeline.py
│   │   ├── scanner.py
│   │   ├── storage.py
│   │   └── health.py
│   ├── services/                    # Business logic — no HTTP concerns
│   │   ├── scanner.py               # File discovery, import, dedup; threading.Lock guard
│   │   ├── thumbnail.py             # ffmpeg frame extraction
│   │   ├── health.py                # Missing/duplicate/corrupt detection
│   │   └── storage.py               # shutil.disk_usage stats
│   └── workers/
│       └── scheduler.py             # APScheduler jobs
│
├── frontend/                        # React app
│   ├── src/
│   │   ├── index.css                # Tailwind + shadcn/ui CSS variables (incl. --popover)
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Timeline.tsx         # Custom CSS grid timeline + date picker popover
│   │   │   ├── Recordings.tsx       # Sortable table + date range picker popover
│   │   │   ├── Activity.tsx         # Scan log and activity feed
│   │   │   └── settings/
│   │   │       ├── Cameras.tsx
│   │   │       └── Locations.tsx
│   │   ├── components/
│   │   │   ├── ui/                  # shadcn/ui copied components
│   │   │   └── VideoPlayer/         # HTML5 video with Range streaming
│   │   ├── api/                     # TanStack Query fetch functions
│   │   │   ├── cameras.ts
│   │   │   ├── recordings.ts
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
│   ├── integration/
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
    camera_type    = CharField()
    location       = ForeignKeyField(Location, backref="cameras", null=True)
    recording_path = CharField()
    enabled        = BooleanField(default=True)
    display_order  = IntegerField(default=0)
    time_source    = CharField(default="filename")  # "filename" | "mtime"
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
    status          = CharField(default="pending")  # pending | ready | missing | corrupted
    created_at      = DateTimeField(default=datetime.now)
    updated_at      = DateTimeField(default=datetime.now)
```

**SQLite pragmas at startup:**
```python
{"journal_mode": "wal", "cache_size": -64000, "synchronous": "NORMAL", "foreign_keys": 1}
```

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

Health
  GET    /api/v1/health                   liveness probe + DB check
  GET    /api/v1/health/recordings         missing, duplicate, corrupted, orphaned counts
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

### Date picker pattern

Both Timeline and Recordings use a Grafana-style compact trigger button that opens a popover. Key implementation details:

- Popup rendered via `ReactDOM.createPortal(…, document.body)` — avoids stacking context issues from `overflow-auto` scroll containers
- Position captured with `getBoundingClientRect()` on open, stored as `position: fixed` coordinates
- Outside-click handled with `document.addEventListener("mousedown", …)` in a `useEffect`
- Standard Tailwind `z-50`; no arbitrary values

### CSS variables

`index.css` defines the full shadcn/ui token set including `--popover` and `--popover-foreground` for both light and dark themes. All popup backgrounds use `bg-popover`.

### Timeline widget

Custom CSS grid implementation (not react-calendar-timeline). Cameras as rows, time as columns, recording segments as absolutely-positioned buttons within percentage-width cells.

---

## 8. Scanner

`app/services/scanner.py`:

- Walks configured camera recording paths; imports files matching video extensions
- Deduplicates by SHA-256 of first 64KB (`file_hash`)
- Extracts timestamps from filename or file mtime (per-camera `time_source` setting)
- Uses `threading.Lock` to prevent concurrent scans
- Returns `(added: int, skipped: int)` per camera; builds a detail string for the activity log

---

## 9. Testing

```
tests/unit/           Pure unit tests (all I/O mocked)
tests/integration/    Real SQLite in-memory + httpx test client — 12 tests, all pass
tests/e2e/            Playwright — API assertions pass; browser tests need a display server
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
COPY migrations/ ./migrations/

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
  -e DATE_FOLDER_FORMAT=%Y-%m-%d \
  camera-event-manager:latest
```

For Python-only changes, hot-patch without rebuilding:
```bash
podman cp scanner.py camera-event-manager:/app/app/services/scanner.py
podman restart camera-event-manager
```

---

## 12. Environment Variables

| Variable | Description |
|---|---|
| `SCAN_INTERVAL_MINUTES` | Scanner poll interval |
| `THUMBNAIL_DIR` | Where thumbnails are written |
| `DATE_FOLDER_FORMAT` | Subfolder date format in recording paths |
| `DATABASE_URL` | SQLite file path |

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
