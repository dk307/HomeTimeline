# Agent Working Guide — Camera Event Manager

Instructions for AI agents (Claude, etc.) working on this codebase.

---

## Server Access

Credentials in `.private/ssh.txt` (gitignored, never commit):
- Line 1: `user@host` (e.g. `root@192.168.1.164`)
- Line 2: password

Connect via paramiko in Python — no system tools (no sshpass, no brew).

```python
import paramiko
creds = open(".private/ssh.txt").read().splitlines()
host, user = creds[0].split("@")[1], creds[0].split("@")[0]
pw = creds[1]
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(host, username=user, password=pw, timeout=10)
```

Container name is `camera-event-manager` (not `hometimeline`).

For long-running commands (build, test), use a fire-and-forget channel pattern:

```python
t = c.get_transport()
ch = t.open_session()
ch.exec_command("nohup long-command > /tmp/out.log 2>&1 &")
ch.close()
# Poll /tmp/out.log separately
```

---

## File Editing Constraints

**The Write and Edit tools truncate files at ~10KB on the Windows-mounted workspace.**

Rules:
1. Always write files to Linux `/tmp` first, then copy to the workspace mount and/or upload to server.
2. Never use `sftp.put()` for large files — it also truncates. Use chunked base64 upload.
3. Verify after every write: `wc -l` and `tail -3` to confirm the file is complete.

### Chunked base64 upload to server

```python
import base64
from pathlib import Path

def upload_b64(client, local_path, remote_path):
    content = Path(local_path).read_bytes()
    b64 = base64.b64encode(content).decode()

    def _run(cmd):
        """Run a remote command and block until it finishes."""
        _, out, err = client.exec_command(cmd)
        out.read()   # blocks until the channel closes (command done)
        err.read()

    _run(f"> {remote_path}.b64")
    for i in range(0, len(b64), 60000):
        _run(f"echo -n '{b64[i:i+60000]}' >> {remote_path}.b64")
    _run(f"base64 -d {remote_path}.b64 > {remote_path} && rm {remote_path}.b64")
```

### Write files to local workspace

Use bash `cp` from `/tmp` to the mount path — do not use the Write tool for files > ~8KB:

```bash
cp /tmp/myfile.py /sessions/<session>/mnt/HomeTimeline/app/myfile.py
```

---

## Deployment

### Full rebuild (frontend or backend changes)

```bash
# 1. Upload changed source files to server via upload_b64()
# 2. Build
podman build --no-cache -f docker/Dockerfile -t camera-event-manager:latest .
# (monitor: tail -f /tmp/build.log)

# 3. Restart container
podman stop camera-event-manager && podman rm camera-event-manager
podman run -d --name camera-event-manager \
  -p 8080:8080 \
  -v /opt/camera-event-manager/data:/app/data \
  -v /nas/camera:/nas/camera:ro \
  camera-event-manager:latest
```

### Hot-patch (no rebuild)

For Python changes:
```bash
podman cp /tmp/changed.py camera-event-manager:/app/app/services/changed.py
podman restart camera-event-manager
```

For frontend-only changes, build in `/tmp` (not on NTFS mount), then upload the new bundle:
```bash
# Build in /tmp to avoid NTFS node_modules issues
cp -r /path/to/frontend /tmp/frontend-build
cd /tmp/frontend-build && npm install && npm run build
# Upload new JS bundle and index.html
podman cp dist/assets/index-HASH.js camera-event-manager:/app/frontend/dist/assets/
podman cp dist/index.html camera-event-manager:/app/frontend/dist/index.html
# Remove old bundle (different hash)
podman exec camera-event-manager rm /app/frontend/dist/assets/index-OLDHASH.js
podman restart camera-event-manager
```

Note: `tsc` and `vite` in node_modules on NTFS may be truncated. Download TypeScript to `/tmp`:
```bash
cd /tmp && npm pack typescript@5.6.2 && tar xzf typescript-5.6.2.tgz
mkdir -p /tmp/bin
printf '#!/bin/sh\nnode /tmp/package/lib/tsc.js "$@"\n' > /tmp/bin/tsc
chmod +x /tmp/bin/tsc
PATH=/tmp/bin:$PATH npm run build
```

### Verify deployment

After any deploy, confirm the new code is live:

```bash
# Health check
curl -s http://localhost:8080/api/v1/health

# Settings API (confirm timezone field present)
curl -s http://localhost:8080/api/v1/settings

# Frontend — grep for a distinctive string in the JS bundle
podman exec camera-event-manager grep -c "createPortal" /app/frontend/dist/assets/index-*.js

# Backend logs
podman logs camera-event-manager --tail 20
```

---

## Persistent Data

All persistent data on the host: `/opt/camera-event-manager/data/`
Mounted into container at: `/app/data/`

| File | Purpose |
|---|---|
| `cam.db` | SQLite database — cameras, recordings, scan events, app settings |
| `app.log` | Application log file |
| `thumbnails/` | Generated video thumbnails |

**Never delete or overwrite these during testing.**

---

## Running Tests Safely

### Unit and integration tests — safe any time

These use isolated per-test SQLite databases in `/tmp`. They never touch production data.

```bash
DATABASE_URL="sqlite:////tmp/test_cam.db" \
RECORDING_LOCATIONS="/tmp/r" \
THUMBNAIL_DIR="/tmp/t" \
python3 -m pytest tests/unit tests/integration -q --tb=short -p no:playwright
```

### E2E tests — protect production data first

E2E tests hit the live container's API and may write to the production database.

**Before running E2E tests:**

```bash
DATA=/opt/camera-event-manager/data
mv $DATA/cam.db      $DATA/cam.db.prod
mv $DATA/cam.db-shm  $DATA/cam.db-shm.prod  2>/dev/null || true
mv $DATA/cam.db-wal  $DATA/cam.db-wal.prod  2>/dev/null || true
mv $DATA/app.log     $DATA/app.log.prod      2>/dev/null || true
mv $DATA/thumbnails  $DATA/thumbnails.prod
mkdir -p $DATA/thumbnails
podman restart camera-event-manager
sleep 3
```

**Run E2E tests:**

```bash
podman exec camera-event-manager pytest tests/e2e -v --base-url=http://localhost:8080
```

**After tests — restore production data:**

```bash
DATA=/opt/camera-event-manager/data
rm -f $DATA/cam.db $DATA/cam.db-shm $DATA/cam.db-wal $DATA/app.log
rm -rf $DATA/thumbnails
mv $DATA/cam.db.prod     $DATA/cam.db
mv $DATA/cam.db-shm.prod $DATA/cam.db-shm  2>/dev/null || true
mv $DATA/cam.db-wal.prod $DATA/cam.db-wal  2>/dev/null || true
mv $DATA/app.log.prod    $DATA/app.log     2>/dev/null || true
mv $DATA/thumbnails.prod $DATA/thumbnails
podman restart camera-event-manager
```

---

## Pre-Commit Checklist

Run these after **every** code change before committing or deploying:

```bash
# 1. Lint + format
python3 -m ruff check --fix .
python3 -m ruff format .
python3 -m ruff check . && python3 -m ruff format --check .

# 2. Unit + integration tests
DATABASE_URL=sqlite:////tmp/test_cam.db \
RECORDING_LOCATIONS=/tmp/test_recordings \
THUMBNAIL_DIR=/tmp/test_thumbnails \
python3 -m pytest tests/unit tests/integration -q --tb=short -p no:playwright

# 3. Frontend typecheck (run in /tmp to avoid NTFS tsc issues)
cd /tmp/frontend-build && PATH=/tmp/bin:$PATH node /tmp/package/lib/tsc.js --noEmit

# 4. Frontend build
PATH=/tmp/bin:$PATH npm run build

# 5. Verify no files are truncated
#    Always write large files via bash or python open(), then verify with wc -l && tail -3
```

CI runs all of the above automatically on every push.

---

## Source Layout

```
app/
  config.py            Settings via pydantic-settings; all paths default to ./data/
  main.py              FastAPI app factory; sets up logging (StreamHandler + FileHandler)
  database.py          Peewee init, WAL pragmas; _migrate() adds columns to existing DBs
  models/
    location.py
    camera.py          time_source: "mtime" | "folder_date"
    recording.py       file_path unique; status: pending | ready | error
    scan_event.py
    app_settings.py    Singleton row: scan_interval_minutes, timezone (IANA)
  schemas/
    app_settings.py    AppSettingsOut, AppSettingsUpdate (both include timezone)
  api/
    cameras.py / locations.py / recordings.py / timeline.py
    scanner.py         POST /scan, GET /status
    storage.py         GET /storage/stats
    activity.py        GET /activity — scan events with TZ-aware timestamps
    logs.py            GET /logs — log buffer with TZ-aware timestamps
    app_settings.py    GET+PATCH /settings; validates timezone via zoneinfo.ZoneInfo()
    health.py          GET /health, GET /health/recordings (wrapped in try/except)
  services/
    scanner.py         File discovery + import; threading.Lock prevents concurrent scans
    thumbnail.py       ffmpeg thumbnail extraction
    health.py          Missing/duplicate/corrupt detection
    storage.py         shutil.disk_usage stats
    log_buffer.py      In-memory ring buffer for the Activity UI
    tz.py              detect local TZ; to_app_tz(); fmt_dt(); lazy-imports AppSettings
  workers/
    scheduler.py       APScheduler jobs

frontend/src/
  index.css            Tailwind base + full shadcn/ui CSS variable set (incl. --popover)
  App.tsx              Layout: sidebar + <main overflow-auto>; React Router routes
  hooks/
    useTimezone.ts     Returns app timezone from settings cache; defaults to "UTC"
  lib/
    tz.ts              fmtDt(iso, tz, opts), FMT_DATETIME, FMT_DATETIME_SHORT, fmtRelative()
  pages/
    Timeline.tsx       Custom CSS grid timeline; DatePicker portal; tick labels via date-fns
    Recordings.tsx     Sortable table; DateRangePicker portal; timestamps via fmtDt
    Dashboard.tsx      Storage stats + recent recordings; timestamps via fmtDt
    Activity.tsx       Scan events; timestamps via fmtDt
    Logs.tsx           Live log stream; timestamps via fmtDt
    settings/
      General.tsx      Scan interval (number input) + timezone (grouped <select> dropdown)
      Cameras.tsx      Camera CRUD
      Locations.tsx    Location CRUD
  components/
    VideoPlayer/       HTML5 <video> with Range request streaming
  api/
    settings.ts        AppSettings interface: { scan_interval_minutes, timezone }
    cameras.ts / recordings.ts / timeline.ts
  store/ui.ts          Zustand: selectedDate, selectedRecordingId

tests/
  conftest.py          autouse fixture: isolated per-test SQLite in tmp_path
  unit/
    test_tz.py         Timezone detection, conversion, fmt_dt() unit tests
    test_storage.py    Storage service unit tests
    test_main.py
  integration/
    test_app_settings_api.py  Settings GET/PATCH including timezone validation
    test_activity_api.py      Activity endpoint with TZ-aware timestamps
    test_health_api.py        Health recording counts
    …
  e2e/
    test_settings.py   General settings page: scan interval + timezone dropdown
    …
```

---

## Common Pitfalls

**`conftest.py` — do not redefine `base_url`**
pytest-playwright provides `--base-url` and the `base_url` fixture. Defining them again causes `ValueError: option names {'--base-url'} already added`.

**NTFS truncation**
The Write and Edit tools (and sftp.put) silently truncate files larger than ~10KB on the Windows-mounted workspace. Always write to `/tmp` first, then `cp` to the mount. Verify with `wc -l` and `tail -3`.

**node_modules on NTFS mount**
`node_modules/.bin/tsc`, `vite`, and other binaries may be truncated/missing when `npm install` runs on NTFS. Always copy the frontend to `/tmp` for building. See the "Hot-patch" section above.

**`_migrate()` must run before any model queries**
In `database.py`, `_migrate()` must be called before `AppSettings.get_instance()`. If a new column is added (e.g., `timezone`) and `_migrate()` runs after the first query, the app will crash with `OperationalError: no such column`. Keep the order: `db.create_tables()` → `_migrate()` → `AppSettings.get_instance()`.

**`bg-popover` needs `--popover` defined**
`index.css` must include `--popover` and `--popover-foreground` in both `:root` and `.dark`. Without this the popup background renders transparent.

**Popover z-index / stacking context**
Date picker popups use `ReactDOM.createPortal(…, document.body)` with `position: fixed; z-index: 200` (`z-[200]`). Do not reduce below 100 — the timeline sticky header uses `z-10` and the camera name column uses `z-10`. The outer timeline/recordings card must NOT have `overflow-hidden` directly on it; put it on the inner scroll container only. `overflow-hidden + border-radius` on an ancestor can create a GPU compositing layer that traps `position: fixed` children in Safari/Chrome.

**Circular import: `tz.py` ↔ `app_settings.py`**
`tz.py` needs to read `AppSettings` to get the configured timezone. Importing at module level creates a circular import. Solution: lazy-import inside the function body:
```python
def get_app_tz() -> zoneinfo.ZoneInfo:
    try:
        from app.models.app_settings import AppSettings  # lazy import
        return zoneinfo.ZoneInfo(AppSettings.get_instance().timezone)
    except Exception:
        return zoneinfo.ZoneInfo(_detect_local_tz())
```

**Build timeout**
`podman build` takes ~2-3 minutes. Always start it with the fire-and-forget channel pattern and poll `/tmp/build.log`.

**Container name**
The running container is named `camera-event-manager`, not `hometimeline`. Always confirm with `podman ps -a` before scripting.
