# Agent Working Guide — Camera Event Manager

Instructions for AI agents (Claude Code, etc.) working on this codebase.

This project is developed from **WSL2** with the repo on the Windows mount
(`/mnt/c/Users/Deepak/dev/HomeTimeline`) and deployed to a self-hosted
**podman** host.

> **Note on older constraints.** Earlier revisions of this guide were written for
> a sandboxed environment that suffered NTFS file truncation, a corrupted git
> index, paramiko-only SSH, and chunked-base64 uploads. **None of that applies in
> the WSL2 / Claude Code setup.** `git`, the `Write`/`Edit` tools, and large-file
> writes on `/mnt/c` all work normally, and `ssh`/`scp`/`rsync` are available.

---

## Environment

**Install the required tooling up front — don't work with sub-optimal software by
choice.** At the start of a task, identify every tool the work actually needs
(container runtime, test/build deps, linters) and confirm it is installed *before*
starting. If something is missing, install it or ask the user to install it — do
**not** fall back to a lesser alternative, stub the step out, or report a check as
"couldn't verify" when the fix is a one-line install. Verifying against the same
tools production uses (e.g. `podman`, Python 3.14) is a requirement, not a nicety.

| Tool | Status |
|---|---|
| `git` | Works directly from WSL2 — commit and push normally. |
| `Write` / `Edit` tools | Work on `/mnt/c` at any size (no truncation). |
| `node` / `npm` | Present locally (node 26). Build the frontend locally. |
| `podman` | Local container runtime (matches production). Install if absent — do **not** substitute Docker or skip image verification. Rootless; builds OCI images, so `HEALTHCHECK` is ignored unless you pass `--format docker`. |
| `ssh` / `scp` / `rsync` | Present locally and on the server. |

**Frontend builds:** run in `/tmp` rather than in-place. It is faster (native
Linux fs instead of the `/mnt/c` NTFS overlay) and keeps the workspace clean —
not because of truncation. Never commit `frontend/dist` or `*.tsbuildinfo`.

---

## Server Access

Host is `root@192.168.1.164`, container `camera-event-manager` (**not**
`hometimeline`). Authenticate with an SSH **key** — no password needed.

The private key lives on the Windows mount at `~/.ssh/id_ed25519`, but its NTFS
permissions are `0777`, which OpenSSH rejects (`UNPROTECTED PRIVATE KEY FILE`).
Copy it to the Linux side once with correct perms and use that copy:

```bash
cp /mnt/c/Users/deepak/.ssh/id_ed25519 ~/.ssh/ht_deploy_key
chmod 600 ~/.ssh/ht_deploy_key
ssh -i ~/.ssh/ht_deploy_key root@192.168.1.164 'podman ps'
```

All examples below assume `-i ~/.ssh/ht_deploy_key`.

**Do not install anything on the server.** It already has `podman`,
`podman-compose`, `rsync`, `tar`, and `curl`. It does **not** have `git`.

---

## Deployment

### Option A — Hot-patch (fast; Python and/or prebuilt frontend)

Best for iterating. Copies files straight into the running container. No image
rebuild. Always back up first.

```bash
KEY=~/.ssh/ht_deploy_key ; SRV=root@192.168.1.164 ; C=camera-event-manager

# 1. Build the frontend locally in /tmp (skip if backend-only change)
rm -rf /tmp/ht-frontend && rsync -a --exclude node_modules --exclude dist frontend/ /tmp/ht-frontend/
( cd /tmp/ht-frontend && npm install --no-audit --no-fund && npm run build )

# 2. Package backend source and built dist
tar czf /tmp/ht-app.tgz  --exclude='__pycache__' --exclude='*.pyc' app
tar czf /tmp/ht-dist.tgz  -C /tmp/ht-frontend/dist .

# 3. Ship to the server
scp -i $KEY /tmp/ht-app.tgz /tmp/ht-dist.tgz $SRV:/tmp/

# 4. Back up, deploy, restart — one remote script
ssh -i $KEY $SRV 'set -e ; C=camera-event-manager
  podman exec $C sh -c "cd /app && tar czf /tmp/app-backup-$(date +%s).tgz app frontend/dist"
  rm -rf /tmp/ht-app /tmp/ht-dist && mkdir -p /tmp/ht-app /tmp/ht-dist
  tar xzf /tmp/ht-app.tgz  -C /tmp/ht-app
  tar xzf /tmp/ht-dist.tgz -C /tmp/ht-dist
  podman exec $C rm -rf /app/app
  podman cp /tmp/ht-app/app $C:/app/app
  podman exec $C sh -c "rm -f /app/frontend/dist/assets/*.js /app/frontend/dist/assets/*.css /app/frontend/dist/index.html"
  podman cp /tmp/ht-dist/assets      $C:/app/frontend/dist/
  podman cp /tmp/ht-dist/index.html  $C:/app/frontend/dist/index.html
  podman restart $C'
```

Backups land in the container at `/tmp/app-backup-<epoch>.tgz` — restore with
`podman exec $C tar xzf /tmp/app-backup-<epoch>.tgz -C /app` then restart.

### Option B — Full rebuild (Dockerfile, deps, or clean release)

The server has a repo copy at `/opt/camera-event-manager` but **no git**, so push
the source with `rsync`, then let `podman-compose` rebuild the image.

**Live view needs the WebRTC candidate.** go2rtc can't detect the host's LAN IP
from inside a container, so `docker-compose.yml` reads `GO2RTC_WEBRTC_CANDIDATE`
from `docker/.env`. If it's empty, WebRTC live view silently fails (go2rtc still
runs and MSE/snapshots work, so `/health` and keyframe probes stay green — only
the browser peer connection breaks). Ensure `docker/.env` exists **before** `up`,
and never let `rsync --delete` remove it (exclude `.env`).

```bash
KEY=~/.ssh/ht_deploy_key ; SRV=root@192.168.1.164

rsync -az --delete -e "ssh -i $KEY" \
  --exclude '.git' --exclude 'node_modules' --exclude 'frontend/dist' \
  --exclude '__pycache__' --exclude '*.pyc' --exclude 'data' --exclude '.env' \
  ./ $SRV:/opt/camera-event-manager/

# WebRTC candidate = host LAN IP:8555 (compose reads docker/.env). Idempotent.
ssh -i $KEY $SRV 'cd /opt/camera-event-manager/docker
  grep -q GO2RTC_WEBRTC_CANDIDATE .env 2>/dev/null \
    || echo "GO2RTC_WEBRTC_CANDIDATE=$(hostname -I | awk "{print \$1}"):8555" > .env
  podman-compose up -d --build'
```

`docker/docker-compose.yml` builds from repo root via `docker/Dockerfile`, mounts
`/opt/camera-event-manager/data` and `/nas/camera:ro`, and exposes `:8080` + `:8555`.

> If `podman-compose up` errors with *"container name already in use"* (it doesn't
> always auto-replace), run `podman-compose down && podman-compose up -d` — the
> `data` bind mount is on the host, so the DB/thumbnails are untouched.

### Verify (after either option)

```bash
KEY=~/.ssh/ht_deploy_key ; SRV=root@192.168.1.164
ssh -i $KEY $SRV '
  curl -s http://localhost:8080/api/v1/health                       # {"status":"ok","db":true}
  curl -s http://localhost:8080/ | grep -o "index-[A-Za-z0-9_-]*\.\(js\|css\)"   # served asset hashes
  podman ps --format "{{.Names}} {{.Status}}" | grep camera-event-manager
  podman logs --tail 15 camera-event-manager'
```

Confirm the served asset hashes match the freshly built files in
`/tmp/ht-frontend/dist/assets` — a mismatch means a stale bundle.

---

## Persistent Data

Host `/opt/camera-event-manager/data/` → container `/app/data/`.

| File | Purpose |
|---|---|
| `cam.db` | SQLite DB — cameras, recordings, scan events, app settings |
| `app.log` | Application log |
| `thumbnails/` | Generated video thumbnails |

**Never delete or overwrite these during testing or deployment.** They live in a
bind-mounted volume, so `podman cp`/rebuild does not touch them — keep it that
way.

---

## Running Tests

### Python environment (first-time setup)

The project requires **Python 3.14+** (`requires-python = ">=3.14"`); the code uses
3.14-only features such as PEP 758 parenthesis-less `except` clauses. Confirm the
interpreter version before creating the venv — `python3 --version` must report 3.14
or newer (install a 3.14 interpreter first if it doesn't).

WSL2's system `python3` has no project deps and no `pip` bootstrap. Create a
venv once:

```bash
python3 -m venv --without-pip ~/.venvs/hometimeline                                 # system python lacks ensurepip
curl -sS https://bootstrap.pypa.io/get-pip.py | ~/.venvs/hometimeline/bin/python   # bootstrap pip into the venv
~/.venvs/hometimeline/bin/python -m pip install -e ".[dev]"                        # app + pytest, ruff, playwright, …
```

Then use `~/.venvs/hometimeline/bin/python -m pytest|ruff` (or activate the venv).

### Unit + integration — safe any time

Isolated per-test SQLite DBs in `tmp_path`; never touch production data.

```bash
DATABASE_URL="sqlite:////tmp/test_cam.db" \
RECORDING_LOCATIONS="/tmp/r" \
THUMBNAIL_DIR="/tmp/t" \
~/.venvs/hometimeline/bin/python -m pytest tests/unit tests/integration -q --tb=short -p no:playwright
```

> Timezone-sensitive tests format datetimes via the app tz, which falls back to
> the **machine's** local zone when unset. Assertions must be offset-**sign**
> agnostic (accept `Z`, `+HH:MM`, or `-HH:MM`) so they pass on Americas
> (negative-offset) machines, not just UTC/CI.

### E2E — run from a workstation, protect production data first

The **production container has no test tooling** (no pytest/playwright/browsers,
no `/app/tests`) — you cannot `podman exec pytest` it. Run e2e from a machine
that has the dev venv **plus browser system libs**:

```bash
~/.venvs/hometimeline/bin/python -m playwright install chromium
sudo ~/.venvs/hometimeline/bin/python -m playwright install-deps chromium   # apt: libnss3, libnspr4, … (needs root)
```

E2E hits the live container and some tests write to the production DB. Swap the
data aside on the server, run pytest locally against the live URL, then restore:

```bash
KEY=~/.ssh/ht_deploy_key ; SRV=root@192.168.1.164
ssh -i $KEY $SRV 'DATA=/opt/camera-event-manager/data
  for f in cam.db cam.db-shm cam.db-wal app.log ; do mv $DATA/$f $DATA/$f.prod 2>/dev/null || true ; done
  mv $DATA/thumbnails $DATA/thumbnails.prod ; mkdir -p $DATA/thumbnails
  podman restart camera-event-manager ; sleep 3'

~/.venvs/hometimeline/bin/python -m pytest tests/e2e -v --base-url http://192.168.1.164:8080

ssh -i $KEY $SRV 'DATA=/opt/camera-event-manager/data
  rm -rf $DATA/thumbnails ; rm -f $DATA/cam.db $DATA/cam.db-shm $DATA/cam.db-wal $DATA/app.log
  for f in cam.db cam.db-shm cam.db-wal app.log ; do mv $DATA/$f.prod $DATA/$f 2>/dev/null || true ; done
  mv $DATA/thumbnails.prod $DATA/thumbnails
  podman restart camera-event-manager'
```

Read-only e2e (e.g. the Timeline picker `test_timeline_page_loads`) can run
without the data swap — they only navigate and assert.

---

## Pre-Commit Checklist

```bash
PY=~/.venvs/hometimeline/bin/python   # see "Python environment" above

# 1. Lint + format
$PY -m ruff check --fix . && $PY -m ruff format .

# 2. Unit + integration tests
DATABASE_URL=sqlite:////tmp/test_cam.db RECORDING_LOCATIONS=/tmp/r THUMBNAIL_DIR=/tmp/t \
  $PY -m pytest tests/unit tests/integration -q -p no:playwright

# 3. Frontend typecheck + build (in /tmp)
rm -rf /tmp/ht-frontend && rsync -a --exclude node_modules --exclude dist frontend/ /tmp/ht-frontend/
( cd /tmp/ht-frontend && npm install --no-audit --no-fund && npm run build )   # runs `tsc -b && vite build`
```

CI runs all of the above on every push. Commit and push directly from WSL2 —
never commit `frontend/dist/` or `*.tsbuildinfo`.

---

## Source Layout

```
app/
  config.py            Settings via pydantic-settings; paths default to ./data/
  main.py              FastAPI app factory; logging (StreamHandler + FileHandler)
  database.py          Peewee init, WAL pragmas; _migrate() adds columns to existing DBs
  models/
    location.py / camera.py / recording.py / scan_event.py
    app_settings.py    Singleton row (ID=1): scan_interval_minutes, timezone (IANA)
  schemas/
    app_settings.py    AppSettingsOut, AppSettingsUpdate (both include timezone)
  api/
    cameras.py / locations.py / recordings.py / timeline.py
    scanner.py         POST /scan, GET /status
    storage.py         GET /storage/stats
    activity.py        GET /activity — scan events, TZ-aware timestamps
    logs.py            GET /logs — log buffer, TZ-aware timestamps
    app_settings.py    GET+PATCH /settings; validates timezone via zoneinfo; invalidates tz cache
    health.py          GET /health, GET /health/recordings (ORM counts, try/except)
  services/
    scanner.py         File discovery + import; threading.Lock guards concurrent scans
    thumbnail.py       ffmpeg thumbnail extraction
    health.py          Missing/duplicate/corrupt detection
    storage.py         shutil.disk_usage stats
    log_buffer.py      In-memory ring buffer for the Logs UI
    tz.py              get_app_tz() (cached), invalidate_tz_cache(); lazy-imports AppSettings
  workers/
    scheduler.py       APScheduler jobs

frontend/src/
  index.css            Tailwind base + full shadcn/ui CSS vars (incl. --popover)
  App.tsx              Layout: sidebar + <main overflow-auto>; React Router routes
  hooks/useTimezone.ts Returns app timezone from settings cache; defaults to "UTC"
  lib/tz.ts            fmtDt(iso, tz, opts), FMT_DATETIME, FMT_DATETIME_SHORT, fmtRelative()
  pages/
    Timeline.tsx       CSS-grid timeline; DatePicker portal (z-[100]); tick labels via date-fns
    Recordings.tsx     Sortable table; DateRangePicker portal (z-[100]); timestamps via fmtDt
    Dashboard.tsx / Activity.tsx / Logs.tsx   timestamps via fmtDt
    settings/General.tsx   Scan interval + timezone (grouped <select> dropdown)
    settings/Cameras.tsx / Locations.tsx      CRUD
  components/VideoPlayer/   HTML5 <video> with Range-request streaming
  api/                 settings.ts / cameras.ts / recordings.ts / timeline.ts
  store/ui.ts          Zustand: selectedDate, selectedRecordingId

tests/
  conftest.py          autouse fixture: isolated per-test SQLite; invalidates tz cache in teardown
  unit/                test_tz.py test_database.py test_storage.py test_main.py …
  integration/         test_app_settings_api.py test_activity_api.py test_health_api.py test_logs_api.py …
  e2e/                 Playwright — requires a running container; protect prod data first
```

---

## Architecture Notes & Pitfalls

**Python 3.14 baseline.** The codebase targets 3.14+ and uses 3.14-native idioms:
PEP 758 parenthesis-less `except A, B:` (valid — *not* the old Py2 `except X, Y`
form), PEP 649 deferred annotations (no forward-ref string quotes needed), and
`datetime.UTC` over `datetime.timezone.utc`. Tools pinned to an older target may
flag these as syntax errors — that's a false positive; run `ruff` (configured for
3.14) as the source of truth. `encode_basic_auth` (used in `hikvision.py`) requires
`aiohttp>=3.14`.

**`_migrate()` must run before any model query.** In `database.py` keep the order
`db.create_tables()` → `_migrate()` → `AppSettings.get_instance()`. A new column
(e.g. `timezone`) queried before migration crashes with `no such column`.

**Circular import: `tz.py` ↔ `app_settings.py`.** `tz.py` reads `AppSettings` for
the configured timezone; importing it at module level is circular. Lazy-import
inside the function:

```python
def get_app_tz() -> zoneinfo.ZoneInfo:
    if _tz_cache is not None:
        return _tz_cache
    from app.models.app_settings import AppSettings  # lazy import
    ...
```

**Timezone cache.** `get_app_tz()` caches the resolved `ZoneInfo` in `_tz_cache`.
Call `invalidate_tz_cache()` after changing `AppSettings.timezone` (the settings
PATCH handler does; the test fixture does in teardown). DB stores UTC-naive
datetimes; conversion happens at API-response time.

**Popover z-index / stacking context.** Date-picker popups use
`ReactDOM.createPortal(…, document.body)` with `position: fixed; z-[100]`. The
timeline sticky header and camera-name column use `z-10`, so don't drop below
that. The outer timeline/recordings card must **not** carry `overflow-hidden`
directly — put it on the inner scroll container only. `overflow-hidden` +
`border-radius` on an ancestor creates a GPU compositing layer that traps
`position: fixed` children.

**Pydantic Literal vs database values.** A `Literal["daily_folder"]` constraint
on a schema field causes a hard 500 error when the database contains a value
outside the literal (e.g., `'aqura_nas_upload'`). All cameras API endpoints
break because `list_cameras` iterates every row through the Pydantic model.
**Always check the database for existing values** before narrowing a field to
a `Literal` — or use a broader type. If adding a new literal variant, add it
to the `Literal[]` in the schema *and* update `_migrate()` in `database.py` if
the column needs a migration. The relevant schemas are in `app/schemas/`:

| Schema | Literal field | Current values |
|---|---|---|
| `camera.py` | `ClipStrategy` | `daily_folder`, `aqura_nas_upload` |
| `camera.py` | `CameraType` | `generic`, `hikvision`, `aqura` |

**`bg-popover` needs `--popover` defined.** `index.css` must include `--popover`
and `--popover-foreground` in both `:root` and `.dark`, or popup backgrounds
render transparent.

**`conftest.py` — do not redefine `base_url`.** pytest-playwright already provides
`--base-url` and the `base_url` fixture; redefining them raises
`ValueError: option names {'--base-url'} already added`.
