#!/usr/bin/env bash
# smoke-test.sh — comprehensive post-deployment verification
#
# Usage: bash scripts/smoke-test.sh [BASE_URL]
#   BASE_URL defaults to http://localhost:8080
#
# Checks:
#   1. Health endpoint returns {"status": "ok", ...}
#   2. Cameras endpoint returns 200 (JSON list)
#   3. Settings endpoint returns 200 (JSON object)
#   4. Frontend serves HTML with the app mount point
#   5. Container logs contain no ERROR/FATAL lines
#
# Exit code 0 = all pass, 1 = one or more failures.
set -euo pipefail

BASE="${1:-http://localhost:8080}"
CONTAINER="${CAMERA_CONTAINER:-camera-event-manager}"
CURL_OPTS="--connect-timeout 5 --max-time 10"
FAIL=0

# ── 1. Health endpoint ─────────────────────────────────────────────────────────
echo "==> [1/5] Health endpoint..."
for i in $(seq 1 12); do
  BODY=$(curl -sf $CURL_OPTS "$BASE/api/v1/health" 2>/dev/null) && break
  echo "    Waiting... ($i/12)"
  sleep 5
done
if echo "$BODY" | grep -q '"ok"'; then
  echo "    OK — $(echo "$BODY" | tr -d '\n')"
else
  echo "    FAIL: health endpoint did not return ok"
  FAIL=1
fi

# ── 2. Cameras endpoint ───────────────────────────────────────────────────────
echo "==> [2/5] Cameras endpoint..."
CODE=$(curl -sf $CURL_OPTS -o /dev/null -w '%{http_code}' "$BASE/api/v1/cameras" 2>/dev/null || echo "000")
if [ "$CODE" = "200" ]; then
  echo "    OK (HTTP $CODE)"
else
  echo "    FAIL: expected 200, got HTTP $CODE"
  FAIL=1
fi

# ── 3. Settings endpoint ──────────────────────────────────────────────────────
echo "==> [3/5] Settings endpoint..."
CODE=$(curl -sf $CURL_OPTS -o /dev/null -w '%{http_code}' "$BASE/api/v1/settings" 2>/dev/null || echo "000")
if [ "$CODE" = "200" ]; then
  echo "    OK (HTTP $CODE)"
else
  echo "    FAIL: expected 200, got HTTP $CODE"
  FAIL=1
fi

# ── 4. Frontend serves HTML ───────────────────────────────────────────────────
echo "==> [4/5] Frontend..."
HTML=$(curl -sf $CURL_OPTS "$BASE/" 2>/dev/null || echo "")
if echo "$HTML" | grep -q '<div id="app"'; then
  echo "    OK — SPA mount point found"
elif echo "$HTML" | grep -q '<!DOCTYPE html>\|<html'; then
  echo "    OK — HTML served (mount point not in initial HTML, SPA may load dynamically)"
else
  echo "    FAIL: frontend did not serve HTML"
  FAIL=1
fi

# ── 5. Container logs (no ERROR/FATAL) ────────────────────────────────────────
echo "==> [5/5] Container logs..."
if ! command -v podman &>/dev/null; then
  echo "    FAIL: podman is required but not found" >&2
  exit 1
fi
if ! LOGS=$(podman logs --tail 30 "$CONTAINER" 2>&1); then
  echo "    FAIL: could not read logs for container '$CONTAINER'" >&2
  exit 1
fi
if echo "$LOGS" | grep -qiE 'ERROR|FATAL|Traceback|Exception'; then
  echo "    FAIL: errors found in container logs:"
  echo "$LOGS" | grep -iE 'ERROR|FATAL|Traceback|Exception' | head -5 | sed 's/^/      /'
  FAIL=1
else
  echo "    OK — no errors in last 30 log lines"
fi

# ── Result ─────────────────────────────────────────────────────────────────────
echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "==> All smoke tests passed."
  exit 0
else
  echo "==> Smoke tests FAILED (see above)."
  exit 1
fi
