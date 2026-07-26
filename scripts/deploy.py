#!/usr/bin/env python3
"""
deploy.py - sync, build image, recreate container, health-check.
Credentials read from .private/ssh.txt (never synced, never in code).
Usage: python scripts/deploy.py [--skip-tests]

Data safety
-----------
The database, thumbnails, and logs live under <DEPLOY_DIR>/data on the
host and are bind-mounted into the container at /app/data.  This script
never runs rsync --delete on data/ — source files are synced separately
via SFTP with an explicit exclusion list.  The container is stopped,
removed, and re-created, but the host data/ directory is untouched.
"""

import argparse
import subprocess
import sys
from pathlib import Path

import paramiko

ROOT = Path(__file__).parent.parent
PRIVATE = ROOT / ".private" / "ssh.txt"
DEPLOY_DIR = "/opt/camera-event-manager"
CONTAINER = "camera-event-manager"
CONTAINER_DATA = "/app/data"
EXCLUDE = {
    ".git",
    ".private",
    "__pycache__",
    ".pytest_cache",
    "node_modules",
    "dist",
    "data",
    ".env",
    ".mypy_cache",
}


def read_ssh_creds():
    if not PRIVATE.exists():
        sys.exit(
            f"ERROR: {PRIVATE} not found.\n"
            "Format:\n  line1: user@host\n  line2: password (optional for key-based auth)"
        )
    lines = PRIVATE.read_text().splitlines()
    host = lines[0].strip()
    password = lines[1].strip() if len(lines) > 1 else None
    user, _, hostname = host.partition("@")
    return user, hostname, password


def read_env() -> dict[str, str]:
    env: dict[str, str] = {}
    env_file = ROOT / ".env"
    if not env_file.exists():
        return env
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip()
    return env


def step(n: int, total: int, msg: str):
    print(f"\n==> [{n}/{total}] {msg}")


def sync_files(ssh: paramiko.SSHClient, remote_dir: str):
    """Sync source files via SFTP.  data/ is never touched."""
    files = [
        p for p in ROOT.rglob("*") if p.is_file() and not (set(p.relative_to(ROOT).parts) & EXCLUDE)
    ]
    print(f"    {len(files)} files...")
    sftp = ssh.open_sftp()
    seen_dirs: set[str] = set()
    for f in files:
        rel = f.relative_to(ROOT).as_posix()
        rpath = f"{remote_dir}/{rel}"
        rdir = rpath.rsplit("/", 1)[0]
        if rdir not in seen_dirs:
            ssh.exec_command(f"mkdir -p {rdir}", timeout=5)
            seen_dirs.add(rdir)
        sftp.put(str(f), rpath)
    sftp.close()


def run_remote(ssh: paramiko.SSHClient, script: str, timeout: int = 600) -> bool:
    _, out, err = ssh.exec_command(script, timeout=timeout)
    for line in out:
        print("   ", line.rstrip())
    rc = out.channel.recv_exit_status()
    if rc != 0:
        stderr = err.read().decode()
        if stderr:
            print(stderr, file=sys.stderr)
    return rc == 0


def main():
    parser = argparse.ArgumentParser(description="Deploy HomeTimeline to remote server")
    parser.add_argument("--skip-tests", action="store_true", help="Skip local test suite")
    args = parser.parse_args()

    user, hostname, password = read_ssh_creds()
    env = read_env()
    app_url = f"http://{hostname}:8080"
    TOTAL = 4

    host_rec = env.get("HOST_RECORDING_PATH", "").strip()
    container_rec = env.get("RECORDING_LOCATIONS", "/nas/camera").strip()
    if not host_rec:
        sys.exit(
            "ERROR: HOST_RECORDING_PATH is not set in .env\n  e.g.  HOST_RECORDING_PATH=/nas/camera"
        )

    # 1 — tests
    if args.skip_tests:
        step(1, TOTAL, "Tests skipped")
    else:
        step(1, TOTAL, "Running tests...")
        rc = subprocess.run(
            [sys.executable, "-m", "pytest", "tests/unit", "tests/integration", "-q", "--tb=short"],
            cwd=ROOT,
        ).returncode
        if rc != 0:
            sys.exit("ERROR: Tests failed — aborting deploy.")
        print("    Passed.")

    # 2 — sync source to server
    step(2, TOTAL, f"Syncing to {user}@{hostname}:{DEPLOY_DIR}")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(hostname, username=user, password=password, timeout=15)

    # Safety: verify data/ exists on the remote host before overwriting source
    try:
        _, out, _ = ssh.exec_command(
            f"test -f {DEPLOY_DIR}/data/cam.db && echo OK || echo MISSING", timeout=5
        )
        resp = out.read().decode().strip()
    except (TimeoutError, paramiko.SSHException, OSError) as exc:
        ssh.close()
        sys.exit(
            f"ERROR: Remote database check failed ({exc.__class__.__name__}) "
            "— aborting before sync."
        )
    if resp == "MISSING":
        print("    WARNING: Remote data/cam.db not found — data may be lost already.")
    elif resp != "OK":
        ssh.close()
        sys.exit(f"ERROR: Unexpected response checking remote database: {resp!r}")

    # Ensure host recording path exists
    if not Path(host_rec).exists():
        print(f"    NOTE: {host_rec} not found locally (may be on NAS).")

    sync_files(ssh, DEPLOY_DIR)
    print("    Done.")

    # 3 — build image + recreate container (data/ is bind-mounted, never deleted)
    step(3, TOTAL, "Building image and recreating container on server...")
    ok = run_remote(
        ssh,
        f"""
set -euo pipefail
cd {DEPLOY_DIR}

# Build fresh image from synced source
podman build -f docker/Dockerfile -t {CONTAINER}:latest . 2>&1 | tail -6

# Stop and remove the old container (host data/ is untouched — it's a bind mount)
podman stop {CONTAINER} 2>/dev/null || true
podman rm {CONTAINER} 2>/dev/null || true

# Create recording path on host if needed
mkdir -p "{host_rec}"

# Start fresh container
podman run -d \\
  --name {CONTAINER} \\
  --restart=unless-stopped \\
  -p 8080:8080 \\
  -p 8555:8555 \\
  -v {DEPLOY_DIR}/data:{CONTAINER_DATA} \\
  -v {host_rec}:{container_rec} \\
  --env-file {DEPLOY_DIR}/.env \\
  -e GO2RTC_WEBRTC_CANDIDATE={hostname}:8555 \\
  --health-cmd "curl -f http://localhost:8080/api/v1/health || exit 1" \\
  --health-interval 10s \\
  --health-timeout 3s \\
  --health-retries 3 \\
  --health-start-period 15s \\
  localhost/{CONTAINER}:latest

echo "    Container started."
""",
    )
    if not ok:
        sys.exit("ERROR: Remote build/start failed.")

    # 4 — smoke test
    step(4, TOTAL, "Smoke test...")
    ok = run_remote(
        ssh,
        f"cd {DEPLOY_DIR} && bash scripts/smoke-test.sh http://localhost:8080",
        timeout=120,
    )
    ssh.close()
    if not ok:
        sys.exit("ERROR: Smoke test failed.")
    print(f"    Live at {app_url}")


if __name__ == "__main__":
    main()
