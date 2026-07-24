#!/usr/bin/env bash
# deploy.sh — validate locally, sync to server, rebuild container, verify health
#
# WARNING: Always use this script or 'make deploy' to deploy.
# DO NOT run raw rsync --delete — it will destroy the server's data/
# directory (cam.db, recordings, thumbnails) if the local data/ is empty.
set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
if [ -f .env ]; then
  export $(grep -v '^#' .env | grep -E '^DEPLOY_' | xargs)
fi
DEPLOY_HOST="${DEPLOY_HOST:-root@192.168.1.164}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/camera-event-manager}"
DEPLOY_PASS="${DEPLOY_PASS:-}"
APP_URL="http://${DEPLOY_HOST#*@}:8080"
SKIP_TESTS="${SKIP_TESTS:-0}"

SSH_CMD="ssh"
RSYNC_CMD="rsync"
if [ -n "$DEPLOY_PASS" ]; then
  export SSHPASS="$DEPLOY_PASS"
  SSH_CMD="sshpass -e ssh"
  RSYNC_CMD="sshpass -e rsync"
fi

# ── Step 1: Local tests ───────────────────────────────────────────────────────
if [ "$SKIP_TESTS" = "0" ]; then
  echo "==> [1/4] Running local tests..."
  python -m pytest tests/unit tests/integration -q --tb=short
  echo "    All tests passed."
else
  echo "==> [1/4] Tests skipped (SKIP_TESTS=1)."
fi

# ── Step 2: Sync source to server ─────────────────────────────────────────────
echo "==> [2/4] Syncing to $DEPLOY_HOST:$DEPLOY_DIR"

# Safety: verify remote data/ has the database before syncing
if ! ssh "$DEPLOY_HOST" "test -f $DEPLOY_DIR/data/cam.db" 2>/dev/null; then
  echo "    WARNING: Remote data/cam.db not found — data may be lost already."
fi

$RSYNC_CMD -az --delete \
  --exclude='.git' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  --exclude='.pytest_cache' \
  --exclude='.mypy_cache' \
  --exclude='coverage' \
  --exclude='frontend/node_modules' \
  --exclude='frontend/dist' \
  --exclude='data' \
  --exclude='.env' \
  --exclude='.private' \
  . "$DEPLOY_HOST:$DEPLOY_DIR"

# ── Step 3: Build image and restart container ─────────────────────────────────
echo "==> [3/4] Building image and restarting container on server..."
$SSH_CMD "$DEPLOY_HOST" bash -s << REMOTE
set -euo pipefail
cd "$DEPLOY_DIR"

# Build new image
podman build -f docker/Dockerfile -t camera-event-manager:latest . 2>&1 | tail -5

# ── Swap container ──────────────────────────────────────────────────────────
podman stop camera-event-manager 2>/dev/null || true
podman rm   camera-event-manager 2>/dev/null || true

# ── Read .env for runtime config (evaluated on the server) ──────────────────
if [ ! -f .env ]; then
  echo "ERROR: .env not found at $DEPLOY_DIR/.env — deploy aborted." >&2
  exit 1
fi
. ./.env
if [ -z "\${HOST_RECORDING_PATH:-}" ]; then
  echo "ERROR: HOST_RECORDING_PATH is not set in .env" >&2
  exit 1
fi
CONTAINER_REC_PATH="\${CONTAINER_RECORDING_PATH:-\${RECORDING_LOCATIONS:-/nas/camera}}"

podman run -d --name camera-event-manager --restart=always \
  -p 8080:8080 \
  -p 8555:8555 \
  -v "$DEPLOY_DIR/data:/opt/camera-event-manager/data" \
  -v "\$HOST_RECORDING_PATH:\$CONTAINER_REC_PATH" \
  --env-file "$DEPLOY_DIR/.env" \
  -e GO2RTC_WEBRTC_CANDIDATE="${DEPLOY_HOST#*@}:8555" \
  localhost/camera-event-manager:latest
REMOTE

# ── Step 4: Health check ──────────────────────────────────────────────────────
echo "==> [4/4] Verifying health..."
for i in $(seq 1 12); do
  if curl -sf "$APP_URL/api/v1/health" | grep -q '"ok"'; then
    echo "    Health check passed — app is live at $APP_URL"
    exit 0
  fi
  echo "    Waiting... ($i/12)"
  sleep 5
done

echo "ERROR: Health check failed after 60s. Check logs with: make logs" >&2
exit 1
