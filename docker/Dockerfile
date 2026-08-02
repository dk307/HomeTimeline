# syntax=docker/dockerfile:1
#
# HomeTimeline — self-hosted home surveillance dashboard
#
# Multi-stage image:
#   Stage 1  Node 26 — builds the React frontend
#   Stage 2  Python 3.14 — shared runtime base (go2rtc, pip, app source)
#
# Targets:
#   (default)            — apt ffmpeg on top of runtime-base (backward-compatible)
#   app-custom-ffmpeg    — COPY ffmpeg from a user-supplied image via --build-context
#
# Custom FFmpeg usage (requires BuildKit):
#   docker buildx build \
#     --target app-custom-ffmpeg \
#     --build-context ffmpeg-source=docker-image://<image> \
#     -f docker/Dockerfile -t hometimeline .
#
# Exposes:
#   8080  FastAPI app (HTTP)
#   8555  go2rtc WebRTC over TCP
#
# HEALTHCHECK hits /api/v1/health every 10 s (see HEALTHCHECK instruction below).

# ---- Stage 1: Node — build React frontend ----
FROM node:26-slim AS frontend
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
ENV NODE_COMPILE_CACHE=/tmp/compile-cache
RUN --mount=type=cache,target=/tmp/compile-cache npm run build

# ---- Stage 2: Shared runtime base (everything except ffmpeg) ----
FROM python:3.14-slim AS runtime-base

ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown
ARG APP_VERSION=0.0.0.dev0
ENV GIT_SHA=${GIT_SHA} BUILD_TIME=${BUILD_TIME} SETUPTOOLS_SCM_PRETEND_VERSION=${APP_VERSION}

# go2rtc — static binary for live WebRTC/MSE streaming (managed as a child process
# by the app, Frigate-style, so the single-container deploy is unchanged).
ARG GO2RTC_VERSION=1.9.14
ARG TARGETARCH=amd64
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && curl -fsSL -o /usr/local/bin/go2rtc \
         "https://github.com/AlexxIT/go2rtc/releases/download/v${GO2RTC_VERSION}/go2rtc_linux_${TARGETARCH}" \
    && chmod +x /usr/local/bin/go2rtc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built React app
COPY --from=frontend /build/dist ./frontend/dist

# Install Python deps
COPY pyproject.toml .
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir ".[prod]"

# Copy app source
COPY app/ ./app/
COPY migrations/ ./migrations/

EXPOSE 8080
# go2rtc WebRTC over TCP (published so browsers on the LAN can connect directly).
EXPOSE 8555

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s \
  CMD curl -f http://localhost:8080/api/v1/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]

# ---- Custom FFmpeg source (BuildKit only — override with --build-context) ----
FROM scratch AS ffmpeg-source
# Empty placeholder. When building app-custom-ffmpeg with BuildKit, override via:
#   --build-context ffmpeg-source=docker-image://<your-image>
# BuildKit resolves --build-context names over stage names for COPY --from.

# ---- Custom target: ffmpeg from user-supplied image (requires BuildKit) ----
FROM runtime-base AS app-custom-ffmpeg
ARG FFMPEG_SRC_BIN_DIR=/usr/local/bin
ARG FFMPEG_SRC_LIB_DIR=/usr/local/lib
ARG FFMPEG_SRC_CODEC_LIB_DIR=/usr/lib/aarch64-linux-gnu
COPY --from=ffmpeg-source ${FFMPEG_SRC_BIN_DIR}/ffmpeg /usr/local/bin/
COPY --from=ffmpeg-source ${FFMPEG_SRC_BIN_DIR}/ffprobe /usr/local/bin/
COPY --from=ffmpeg-source ${FFMPEG_SRC_LIB_DIR}/libsvtav1.so* /usr/local/lib/
RUN ldconfig
COPY --from=ffmpeg-source ${FFMPEG_SRC_CODEC_LIB_DIR}/libx264.so* /usr/lib/aarch64-linux-gnu/
COPY --from=ffmpeg-source ${FFMPEG_SRC_CODEC_LIB_DIR}/libx265.so* /usr/lib/aarch64-linux-gnu/
COPY --from=ffmpeg-source ${FFMPEG_SRC_CODEC_LIB_DIR}/libavcodec.so* /usr/lib/aarch64-linux-gnu/
COPY --from=ffmpeg-source ${FFMPEG_SRC_CODEC_LIB_DIR}/libfdk-aac.so* /usr/lib/aarch64-linux-gnu/
COPY --from=ffmpeg-source ${FFMPEG_SRC_CODEC_LIB_DIR}/libvpx.so* /usr/lib/aarch64-linux-gnu/
RUN ldconfig

# ---- Default target: apt ffmpeg (backward-compatible, podman-safe) ----
FROM runtime-base
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
