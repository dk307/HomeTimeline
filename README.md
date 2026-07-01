# Camera Event Manager

[![CI](https://github.com/dk307/HomeTimeline/actions/workflows/ci.yml/badge.svg)](https://github.com/dk307/HomeTimeline/actions/workflows/ci.yml)
[![Docker](https://img.shields.io/badge/container-ghcr.io-blue?logo=docker)](https://github.com/dk307/HomeTimeline/pkgs/container/hometimeline)
[![Python](https://img.shields.io/badge/python-3.13-blue)](https://www.python.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A lightweight, self-hosted web application for browsing and managing event-based security camera recordings.

Does **not** do continuous recording or motion detection — those are handled by external systems (e.g. Home Assistant). CEM provides the library, timeline, and playback interface.

---

## Features

- **Timeline** — multi-camera, zoomable, date-range navigation, thumbnail preview on bars, click-to-play
- **Recordings** — sortable table, date/camera filtering, thumbnail preview, inline playback, download
- **Scanner** — auto-discovers recordings on NAS; deduplicates by hash; generates thumbnails via ffmpeg; runs on a configurable schedule or on demand per-camera
- **Dashboard** — storage stats, recent recordings, health summary
- **Settings** — general app settings (scan frequency), per-camera config, location management

---

## Stack

| Layer | Choice |
|---|---|
| Backend | FastAPI + Peewee + SQLite (WAL) |
| Frontend | React 18 + TypeScript + Vite + shadcn/ui + Tailwind |
| Video | ffmpeg (probe + thumbnails) + HTML5 range streaming |
| Container | Podman (rootless) or Docker on any Linux server |
| CI/CD | GitHub Actions — lint, test, build, push to ghcr.io on main |

---

## Quick Start

Requires SSH access to a Linux server with Podman installed.

```bash
podman run -d --name camera-event-manager \
  -p 8080:8080 \
  -v /opt/cem/data:/opt/camera-event-manager/data \
  -v /nas/camera:/nas/camera:ro \
  -e DATABASE_URL=sqlite:////opt/camera-event-manager/data/cam.db \
  -e RECORDING_LOCATIONS=/nas/camera \
  -e THUMBNAIL_DIR=/opt/camera-event-manager/data/thumbnails \
  ghcr.io/dk307/hometimeline:latest
```

App served at `http://server:8080`. Scan frequency and other app settings can be changed live from **Settings → General**.

---

## Deployment (from source)

Store SSH credentials in `.private/ssh.txt` (gitignored): line 1 = `user@host`, line 2 = password.

```bash
python scripts/deploy.py
```

This syncs source, builds the Docker image on the server via `podman build`, and restarts the container.

### Persisted data (survives rebuilds)

All persistent data lives on the host, mounted into the container:

| Path | Purpose |
|---|---|
| `data/cam.db` | SQLite database (recordings, cameras, scan events, settings) |
| `data/app.log` | Application log |
| `data/thumbnails/` | Generated video thumbnails |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./data/cam.db` | SQLite path |
| `RECORDING_LOCATIONS` | `/mnt/recordings` | Colon-separated list of root recording dirs |
| `THUMBNAIL_DIR` | `./data/thumbnails` | Thumbnail output directory |
| `SCAN_INTERVAL_MINUTES` | `5` | Fallback scan interval (overridden by DB setting) |
| `LOG_FILE` | `./data/app.log` | Log file path |
| `LOG_LEVEL` | `INFO` | Logging verbosity |

> Scan frequency is also configurable at runtime via **Settings → General** in the UI — no restart needed.

---

## Running Tests

```bash
# Unit + integration (isolated tmp DB, safe any time)
pytest tests/unit tests/integration -v

# E2E (needs a running container)
pytest tests/e2e -v --base-url=http://localhost:8080
```

---

## CI / CD

| Trigger | What runs |
|---|---|
| Every push / PR | Backend lint (ruff), unit + integration tests, frontend type-check + build |
| PR only | Docker build smoke test (no push) |
| Merge to main | Docker build + push to `ghcr.io/dk307/hometimeline:latest` and `:<sha>` |

---

## Project Structure

```
app/               FastAPI backend
  api/             Route handlers (cameras, recordings, timeline, settings, …)
  models/          Peewee ORM models
  schemas/         Pydantic request/response schemas
  services/        Scanner, log buffer
  workers/         APScheduler background job
frontend/src/      React frontend
  api/             Typed API clients
  pages/           Page components (Dashboard, Timeline, Recordings, Settings)
  components/      Shared components (VideoPlayer)
  store/           Zustand UI state
tests/
  unit/            Pure unit tests (scanner, models)
  integration/     FastAPI TestClient against in-memory DB
  e2e/             Playwright browser tests against live container
docker/Dockerfile  Multi-stage: node:22-slim builds frontend → python:3.13-slim runtime
docs/              Architecture design and agent guide
```

See `docs/DESIGN.md` for full architecture decisions.
