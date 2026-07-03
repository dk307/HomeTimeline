#!/usr/bin/env bash
# hot_patch.sh — copy changed app/ files into the running container without rebuilding
set -euo pipefail

if [ -f .env ]; then
  { set -a; source .env; set +a; } 2>/dev/null || true
fi
DEPLOY_HOST="${DEPLOY_HOST:-root@192.168.1.164}"
CONTAINER="${CONTAINER:-camera-event-manager}"
if [[ ! "$CONTAINER" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo "ERROR: CONTAINER name '${CONTAINER}' contains invalid characters" >&2
  exit 1
fi

SSH_CMD="ssh"
RSYNC_CMD="rsync"
if [ -n "${DEPLOY_PASS:-}" ]; then
  export SSHPASS="$DEPLOY_PASS"
  SSH_CMD="sshpass -e ssh"
  RSYNC_CMD="sshpass -e rsync"
fi

echo "==> [1/3] Syncing app/ to server..."
$RSYNC_CMD -az --relative \
  app/api/app_settings.py \
  app/api/health.py \
  app/api/timeline.py \
  app/models/scan_event.py \
  app/services/storage.py \
  "$DEPLOY_HOST:/tmp/cem_patch/"

echo "==> [2/3] Patching container files and restarting..."
$SSH_CMD "$DEPLOY_HOST" bash << REMOTE
set -euo pipefail
CONTAINER="$CONTAINER"
FILES="app/api/app_settings.py app/api/health.py app/api/timeline.py app/models/scan_event.py app/services/storage.py"
for f in \$FILES; do
  podman cp "/tmp/cem_patch/\$f" "\$CONTAINER:/app/\$f"
  echo "    patched /app/\$f"
done
podman restart "\$CONTAINER"
rm -rf /tmp/cem_patch
REMOTE

echo "==> [3/3] Health check..."
HOST_IP="${DEPLOY_HOST#*@}"
sleep 4
for i in $(seq 1 10); do
  if curl -sf "http://${HOST_IP}:8080/api/v1/health" | grep -q '"ok"'; then
    echo "    App is live at http://${HOST_IP}:8080"
    exit 0
  fi
  echo "    Waiting... ($i/10)" && sleep 2
done
echo "ERROR: health check failed after 24s" >&2
exit 1
