# ---- Stage 1: Build React frontend ----
# syntax=docker/dockerfile:1
FROM node:26-slim AS frontend
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
ENV NODE_COMPILE_CACHE=/tmp/compile-cache
RUN --mount=type=cache,target=/tmp/compile-cache npm run build

# ---- Stage 2: Python runtime ----
FROM python:3.14-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# go2rtc — static binary for live WebRTC/MSE streaming (managed as a child process
# by the app, Frigate-style, so the single-container deploy is unchanged).
ARG GO2RTC_VERSION=1.9.14
ARG TARGETARCH=amd64
RUN curl -fsSL -o /usr/local/bin/go2rtc \
      "https://github.com/AlexxIT/go2rtc/releases/download/v${GO2RTC_VERSION}/go2rtc_linux_${TARGETARCH}" \
    && chmod +x /usr/local/bin/go2rtc

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
