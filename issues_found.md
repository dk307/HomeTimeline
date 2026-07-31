# Code Review Issues — Branch Review

## Critical Issues

### 1. `clip_strategy` field exists but scanner never used it (FIXED)
- **Files**: `app/models/camera.py:27`, `app/services/scanner.py`, `app/schemas/camera.py`
- **Description**: The `Camera` model has a `clip_strategy` field (default `"daily_folder"`), and the schema exposes it in the API, but the scanner never read it. The old `time_source` field was removed but the replacement logic wasn't implemented.
- **Impact**: Dead code. If a future strategy like `"aqura_nas_upload"` is added, the scanner won't handle it differently.
- **Root cause**: `index_recording()` always used `creation_time` from ffprobe if available, ignoring `clip_strategy`. Per design:
  - `daily_folder`: should use mtime-based timestamps (end_time = mtime, start = end − duration)
  - `aqura_nas_upload`: should use `creation_time` from ffprobe, fall back to mtime
- **Fix**: Added `camera.clip_strategy == "aqura_nas_upload"` check before using `creation_time`. Added schema validators to enforce strategy per camera_type (Hikvision=daily_folder, Aqura=aqura_nas_upload). Updated UI to show read-only for both camera types.
- **Commits**: `5a6fd0b`, `9b4ffff`

### 2. Inconsistent return key format across bulk operations (FIXED)
- **Files**: `app/services/scanner.py`, `app/services/downloader.py`, `app/services/purger.py`
- **Description**:
  | Function | Return Key | Before | After |
  |----------|------------|--------|-------|
  | `scan_all()` | `camera.name` → `camera.id` | `{"camera_name": 3}` | `{"1": 3}` |
  | `download_all()` | `str(camera.id)` | `{"1": 5}` | `{"1": 5}` (unchanged) |
  | `purge_all()` | `str(camera.id)` | `{"1": 2}` | `{"1": 2}` (unchanged) |
- **Impact**: Frontend consumers expecting a uniform API would break.
- **Fix**: Standardized `scan_all()` and `scan_single_camera()` to use `str(camera.id)` as key, matching `download_all()` and `purge_all()`.
- **Commit**: `02cb6df`

## Potential Bugs

### 3. Scheduler doesn't reschedule on camera enable/disable without API call
- **File**: `app/workers/scheduler.py:156`
- **Description**: Cameras are loaded once at startup in `start_scheduler()`. If a camera is disabled/enabled via direct DB manipulation (not API), the scheduler won't know.
- **Mitigation**: `_run_camera_scan` checks `camera.enabled` and returns early, so extra jobs do no work. Minor issue.

## Code Quality / Style

### 4. Explicit `__enter__`/`__exit__` instead of `with` statement
- **File**: `app/services/scanner.py:335-336`, `416-417`, `434`
- **Description**: Manual context manager protocol calls instead of `with` statement.
- **Example**:
  ```python
  lock_ctx = _acquire_scan_lock(camera.id)
  lock_ctx.__enter__()
  try:
      ...
  finally:
      lock_ctx.__exit__(None, None, None)
  ```
- **Fix**: Use `with _acquire_scan_lock(camera.id):`

### 5. Shadowing built-in `count`
- **File**: `app/services/storage.py:54`
- **Description**: `count = cam_recs.count()` shadows the built-in `count`.
- **Fix**: Rename to `rec_count` or `total_recs`.

## Missing Feature / Incomplete Work

### 6. Aqura camera download/purge not scheduled
- **File**: `app/workers/scheduler.py:189`, `206`
- **Description**: Scheduler explicitly skips download/purge jobs for non-Hikvision cameras:
  ```python
  if cam.camera_type != "hikvision" or not cam.download_interval_minutes:
      continue
  ```
- **Context**: Matches current API (Aqura has no download/purge endpoints), but model has `stream_url_*` fields suggesting Aqura support was planned.

---

## Priority Summary

| Priority | Issue | Status |
|----------|-------|--------|
| **High** | #1: Implement or remove `clip_strategy` | ✅ Fixed in `5a6fd0b`, `9b4ffff` |
| **Medium** | #2: Standardize bulk operation return keys (name vs ID) | ✅ Fixed in `02cb6df` |
| **Low** | #3: Scheduler doesn't reschedule on camera enable/disable | Open (mitigated) |
| **Low** | #4: Use `with` statement for lock context managers | Open (readability) |
| **Low** | #5: Rename `count` variable in storage service | Open |