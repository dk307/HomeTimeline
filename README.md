# Camera Event Manager

A lightweight, self-hosted web application for browsing and managing event-based security camera recordings.

Does **not** do continuous recording or motion detection — those are handled by external systems (e.g. Home Assistant). CEM provides the library, timeline, and playback interface.

---

## Features (Phase 1)

- **Timeline** — multi-camera, zoomable, date-range navigation, click-to-play
- **Recordings** — sortable table, date/camera filtering, inline playback, download
- **Scanner** — auto-discovers recordings on NAS; deduplicates by hash; runs on a schedule or on demand
- **Dashboard** — storage stats, recent recordings, health summary
- **Settings** — camera and location management

---

## Stack

| Layer | Choice |
|---|---|
| Backend | FastAPI + Peewee + SQLite (WAL) |
| Frontend | React 18 + TypeScript + Vite + shadcn/ui + Tailwind |
| Video | ffmpeg (thumbnails) + HTML5 Range streaming |
| Container | Podman (rootless) on Linux server |

---

## Deployment

Requires SSH access to a Linux server with Podman installed.

Store credentials in `.private/ssh.txt` (gitignored): line 1 = `user@host`, line 2 = password.

**Build and run:**

```bash
cd /opt/camera-event-manager

podman build --no-cache -f docker/Dockerfile -t camera-event-manager:latest .

podman stop camera-event-manager && podman rm camera-event-manager

podman run -d --name camera-event-manager \
  -p 8080:8080 \
  -v /opt/camera-event-manager/data:/app/data \
  -v /nas/camera:/nas/camera:ro \
  -e SCAN_INTERVAL_MINUTES=5 \
  -e DATE_FOLDER_FORMAT=%Y-%m-%d \
  camera-event-manager:latest
```

App served at `http://server:8080`.

### Persisted data (survives rebuilds)

All persistent data lives on the host at `/opt/camera-event-manager/data/`, mounted into the container at `/app/data/`:

| File | Purpose |
|---|---|
| `cam.db` | SQLite database (recordings, cameras, scan events) |
| `app.log` | Application and uvicorn log file |
| `thumbnails/` | Generated video thumbnails |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SCAN_INTERVAL_MINUTES` | `5` | How often the scanner runs |
| `DATE_FOLDER_FORMAT` | `%Y-%m-%d` | Subfolder date format in recording paths |
| `DATABASE_URL` | `sqlite:///./data/cam.db` | SQLite path (relative to `/app`) |
| `THUMBNAIL_DIR` | `./data/thumbnails` | Thumbnail output directory |
| `LOG_FILE` | `./data/app.log` | Log file path |
| `LOG_LEVEL` | `INFO` | Logging verbosity |

---

## Running Tests

```bash
# Unit + integration — isolated tmp DB, safe to run any time
podman exec camera-event-manager pytest tests/unit tests/integration -v

# E2E — hits live container; back up production data first (see AGENT.md)
```

---

## Project Structure

```
app/               FastAPI backend (routers, models, services, workers)
frontend/src/      React frontend (pages, components, api hooks, store)
tests/             Unit, integration, and E2E tests
docker/Dockerfile  Multi-stage build: node:22-slim → python:3.13-slim
docs/              Architecture design, product requirements, agent guide
```

See `docs/DESIGN.md` for full architecture and `AGENT.md` for AI agent working instructions.
