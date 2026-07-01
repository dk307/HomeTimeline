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
    client.exec_command("rm -f /tmp/up.b64")
    for i in range(0, len(b64), 60000):
        client.exec_command(f"printf '%s' '{b64[i:i+60000]}' >> /tmp/up.b64")
    client.exec_command(
        f"python3 -c \"import base64; open('{remote_path}','wb')"
        f".write(base64.b64decode(open('/tmp/up.b64').read()))\""
    )
    client.exec_command("rm -f /tmp/up.b64")
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
# (monitor: tail -3 /tmp/build.log)

# 3. Restart container
podman stop camera-event-manager && podman rm camera-event-manager
podman run -d --name camera-event-manager \
  -p 8080:8080 \
  -v /opt/camera-event-manager/data:/app/data \
  -v /nas/camera:/nas/camera:ro \
  -e SCAN_INTERVAL_MINUTES=5 \
  camera-event-manager:latest
```

### Hot-patch (Python-only changes, no rebuild)

```bash
podman cp /tmp/changed_file.py camera-event-manager:/app/app/services/changed_file.py
podman restart camera-event-manager
```

### Verify deployment

After any deploy, confirm the new code is live:

```bash
# For frontend — grep for a distinctive string in the JS bundle
podman exec camera-event-manager grep -c "createPortal" /app/frontend/dist/assets/index-*.js

# For backend — check logs or hit an endpoint
podman logs camera-event-manager --tail 10
curl -s http://localhost:8080/api/health
```

---

## Persistent Data

All persistent data on the host: `/opt/camera-event-manager/data/`
Mounted into container at: `/app/data/`

| File | Purpose |
|---|---|
| `cam.db` | SQLite database — cameras, recordings, scan events |
| `app.log` | Application log file |
| `thumbnails/` | Generated video thumbnails |

**Never delete or overwrite these during testing.**

---

## Running Tests Safely

### Unit and integration tests — safe any time

These use isolated per-test SQLite databases in `/tmp`. They never touch production data.

```bash
podman exec camera-event-manager pytest tests/unit tests/integration -v
```

### E2E tests — protect production data first

E2E tests hit the live container's API and may write to the production database.

**Before running E2E tests:**

```bash
# On the server host — move production data aside
DATA=/opt/camera-event-manager/data
mv $DATA/cam.db      $DATA/cam.db.prod
mv $DATA/cam.db-shm  $DATA/cam.db-shm.prod  2>/dev/null || true
mv $DATA/cam.db-wal  $DATA/cam.db-wal.prod  2>/dev/null || true
mv $DATA/app.log     $DATA/app.log.prod      2>/dev/null || true
mv $DATA/thumbnails  $DATA/thumbnails.prod
mkdir -p $DATA/thumbnails
# Restart container so it initialises a fresh DB
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
# Remove test artifacts
rm -f $DATA/cam.db $DATA/cam.db-shm $DATA/cam.db-wal $DATA/app.log
rm -rf $DATA/thumbnails
# Restore
mv $DATA/cam.db.prod     $DATA/cam.db
mv $DATA/cam.db-shm.prod $DATA/cam.db-shm  2>/dev/null || true
mv $DATA/cam.db-wal.prod $DATA/cam.db-wal  2>/dev/null || true
mv $DATA/app.log.prod    $DATA/app.log     2>/dev/null || true
mv $DATA/thumbnails.prod $DATA/thumbnails
# Restart to reconnect production DB
podman restart camera-event-manager
```

---

## Pre-Commit Checklist

Run these after **every** code change before committing or deploying:

```bash
# 1. Lint
python3 -m ruff check .

# 2. Format (auto-fix, then verify)
python3 -m ruff format .
python3 -m ruff format --check .

# 3. Unit + integration tests
python -m pytest tests/unit tests/integration -q --tb=short -p no:playwright

# 4. Verify no files are truncated
#    (Windows NTFS mount silently truncates files > ~10KB written via Edit/Write tools)
#    Always write large files via: python3 -c "open(path,'w').write(content)"
#    Then verify: wc -l <file> && tail -3 <file>
```

CI runs all of the above automatically on every push. A failing pre-commit check **will** fail CI.

---

## Source Layout

```
app/
  config.py          Settings via pydantic-settings; all paths default to ./data/
  main.py            FastAPI app factory; sets up logging (StreamHandler + FileHandler)
  database.py        Peewee init, WAL pragmas
  models/            Peewee models: Location, Camera, Recording, ScanEvent, AppSettings
  schemas/           Pydantic request/response shapes
  api/               FastAPI routers (one file per resource — cameras, recordings, timeline, settings, …)
  services/
    scanner.py       File discovery + import; threading.Lock prevents concurrent scans
    thumbnail.py     ffmpeg thumbnail extraction
    health.py        Missing/duplicate/corrupt detection
    storage.py       shutil.disk_usage stats
    log_buffer.py    In-memory ring buffer for the Activity UI
  workers/
    scheduler.py     APScheduler jobs

frontend/src/
  index.css          Tailwind base + full shadcn/ui CSS variable set (incl. --popover)
  App.tsx            Layout: sidebar + <main overflow-auto>; React Router routes
  pages/
    Timeline.tsx     Custom CSS grid timeline; DatePicker uses createPortal
    Recordings.tsx   Sortable table; DateRangePicker uses createPortal
    Dashboard.tsx    Storage stats + recent recordings
    Activity.tsx     Scan log / activity feed
    settings/        General, Camera and Location CRUD forms
  components/
    VideoPlayer/     HTML5 <video> with Range request streaming
  api/               TanStack Query fetch functions
  store/ui.ts        Zustand: selectedDate, selectedRecordingId

tests/
  conftest.py        autouse fixture: isolated per-test SQLite in tmp_path
  unit/              Pure unit tests (all I/O mocked)
  integration/       Real SQLite + httpx TestClient; no live server needed
  e2e/
    conftest.py      Minimal — base_url provided by pytest-playwright, not redefined
```

---

## Common Pitfalls

**`conftest.py` — do not redefine `base_url`**
pytest-playwright provides `--base-url` and the `base_url` fixture. Defining them again causes `ValueError: option names {'--base-url'} already added`.

**`scanner.py` truncation**
The file was previously truncated on the server mid-line. Always verify uploaded files with `wc -l` and check for syntax errors with `python3 -m py_compile`.

**Arbitrary Tailwind values**
Avoid `z-[9999]`, `w-[340px]` etc. Use standard scale values. Since popovers use `createPortal`, `z-50` is sufficient.

**`bg-popover` needs `--popover` defined**
`index.css` must include `--popover` and `--popover-foreground` in both `:root` and `.dark`. Without this the class renders transparent.

**Popover z-index / stacking context**
The app layout has `<main className="overflow-auto">` which creates a stacking context. All floating UI (date pickers, dropdowns) must use `ReactDOM.createPortal(…, document.body)` to escape it.

**Build timeout**
`podman build` takes ~2-3 minutes. Always start it with the fire-and-forget channel pattern and poll `/tmp/build.log`.
