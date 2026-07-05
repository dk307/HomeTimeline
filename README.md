# Camera Event Manager

[![CI](https://github.com/dk307/HomeTimeline/actions/workflows/ci.yml/badge.svg)](https://github.com/dk307/HomeTimeline/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/dk307/HomeTimeline/branch/main/graph/badge.svg)](https://codecov.io/gh/dk307/HomeTimeline)
[![Docker](https://img.shields.io/badge/container-ghcr.io-blue?logo=docker)](https://github.com/dk307/HomeTimeline/pkgs/container/hometimeline)
[![Python](https://img.shields.io/badge/python-3.13-blue)](https://www.python.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A lightweight, self-hosted web application for browsing and managing event-based security camera recordings.

Does **not** do continuous recording or motion detection — those are handled by external systems (e.g. Home Assistant). CEM provides the library, timeline, and playback interface.

---

## Features

- **Timeline** — multi-camera, zoomable, date-range navigation, thumbnail preview on bars, click-to-play
- **Recordings** — sortable table, date/camera filtering, thumbnail preview, inline playback, download
- **Scanner** — auto-discovers recordings on NAS; deduplicates by hash; generates thumbnails via ffmpeg; runs on a per-camera schedule (or **Never** for manual-only) or on demand per-camera
- **Hikvision cameras** — a camera can be typed **Hikvision** with host/credentials; the app pulls clips directly over ISAPI (per-day `YYYY-MM-DD` folders), indexes them like scanned files, shows live device details (model/firmware/RTSP/snapshot), and downloads on a per-camera schedule (or **Never** for manual-only) via a **Download Videos** button
- **Live view** — real-time WebRTC video for Hikvision cameras via an embedded **go2rtc** bridge, with a **main/sub** stream switch; the camera page puts the live feed on top over **Timeline / Details / Commands** tabs
- **Dashboard** — storage stats, recent recordings, health summary
- **Settings** — general app settings (display timezone), per-camera config (type, clip storage strategy, scan schedule, Hikvision connection + download schedule), location management
- **Timezone** — all timestamps stored as UTC; displayed in any IANA timezone configured in General Settings

---

## Stack

| Layer | Choice |
|---|---|
| Backend | FastAPI + Peewee + SQLite (WAL) |
| Frontend | React 18 + TypeScript + Vite + shadcn/ui + Tailwind |
| Video | ffmpeg (probe + thumbnails) + HTML5 range streaming; go2rtc (live WebRTC) |
| Container | Podman (rootless) or Docker on any Linux server |
| CI/CD | GitHub Actions — lint, test, build, push to ghcr.io on main |

---

## Quick Start

Requires SSH access to a Linux server with Podman installed.

```bash
podman run -d --name camera-event-manager \
  -p 8080:8080 \
  -p 8555:8555 \
  -v /opt/cem/data:/opt/camera-event-manager/data \
  -v /nas/camera:/nas/camera \
  -e DATABASE_URL=sqlite:////opt/camera-event-manager/data/cam.db \
  -e RECORDING_LOCATIONS=/nas/camera \
  -e THUMBNAIL_DIR=/opt/camera-event-manager/data/thumbnails \
  -e LOG_FILE=/opt/camera-event-manager/data/app.log \
  -e GO2RTC_WEBRTC_CANDIDATE=<server-lan-ip>:8555 \
  ghcr.io/dk307/hometimeline:latest
```

> The recordings volume is mounted **read-write** (no `:ro`): Hikvision cameras download
> clips into it. Use `:ro` only if you have no Hikvision cameras.
>
> Port **8555** and `GO2RTC_WEBRTC_CANDIDATE=<server-lan-ip>:8555` are needed for **live view**
> (WebRTC): inside a container go2rtc can't detect the host's LAN address, so it's passed explicitly.
> `scripts/deploy.py` sets both automatically. Omit them if you don't need live view.

App served at `http://server:8080`. Display timezone and other app settings can be changed live from **Settings → General**; each camera's scan schedule is configured per-camera under **Settings → Cameras**.

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
| `SCAN_INTERVAL_MINUTES` | — | Legacy/unused — scan schedules are now per-camera (**Settings → Cameras**); this env var is ignored |
| `LOG_FILE` | `./data/app.log` | Log file path (rotating, 5×5 MB). **Point it inside the mounted data volume** so logs survive container restarts. |
| `LOG_LEVEL` | `INFO` | Logging verbosity |

> Display timezone is configurable at runtime via **Settings → General**, and each camera's scan schedule via **Settings → Cameras** — no restart needed.

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
  services/        Scanner, log buffer, timezone utilities
  workers/         APScheduler background job
frontend/src/      React frontend
  api/             Typed API clients
  hooks/           Custom React hooks (useTimezone)
  lib/             Utility modules (tz.ts — timezone-aware date formatting)
  pages/           Page components (Dashboard, Timeline, Recordings, Settings)
  components/      Shared components (VideoPlayer)
  store/           Zustand UI state
tests/
  unit/            Pure unit tests (scanner, models, tz utilities)
  integration/     FastAPI TestClient against in-memory DB
  e2e/             Playwright browser tests against live container
docker/Dockerfile  Multi-stage: node:22-slim builds frontend → python:3.13-slim runtime
docs/              Architecture design and agent guide
```

See `docs/DESIGN.md` for full architecture decisions.
