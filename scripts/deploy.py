#!/usr/bin/env python3
"""
deploy.py - validate, sync, rebuild, restart, health-check.
Credentials read from .private/ssh.txt (never synced, never in code).
Usage: python scripts/deploy.py [--skip-tests]

WARNING: Always use this script or 'make deploy' to deploy.
DO NOT run raw rsync --delete — it will destroy the server's data/
directory (cam.db, recordings, thumbnails) if the local data/ is empty.
"""

import argparse
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

import paramiko

ROOT = Path(__file__).parent.parent
PRIVATE = ROOT / ".private" / "ssh.txt"
DEPLOY_DIR = "/opt/camera-event-manager"
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
        sys.exit(f"ERROR: {PRIVATE} not found.\nFormat:\n  line1: user@host\n  line2: password")
    lines = PRIVATE.read_text().splitlines()
    host, password = lines[0].strip(), lines[1].strip()
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


def step(n, total, msg):
    print(f"\n==> [{n}/{total}] {msg}")


def sync_files(ssh: paramiko.SSHClient, remote_dir: str):
    """Sync via SFTP — reliable, no truncation."""
    files = [
        p for p in ROOT.rglob("*") if p.is_file() and not (set(p.relative_to(ROOT).parts) & EXCLUDE)
    ]
    print(f"    {len(files)} files...")
    sftp = ssh.open_sftp()
    seen_dirs: set = set()
    for f in files:
        rel = f.relative_to(ROOT).as_posix()
        rpath = f"{remote_dir}/{rel}"
        rdir = rpath.rsplit("/", 1)[0]
        if rdir not in seen_dirs:
            ssh.exec_command(f"mkdir -p {rdir}", timeout=5)
            seen_dirs.add(rdir)
        sftp.put(str(f), rpath)
    sftp.close()


def run_remote(ssh, script, timeout=600):
    _, out, err = ssh.exec_command(script, timeout=timeout)
    for line in out:
        print("   ", line.rstrip())
    rc = out.channel.recv_exit_status()
    if rc != 0:
        print(err.read().decode(), file=sys.stderr)
    return rc == 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-tests", action="store_true")
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

    # 2 — sync
    step(2, TOTAL, f"Syncing to {user}@{hostname}:{DEPLOY_DIR}")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(hostname, username=user, password=password, timeout=15)

    # Safety: verify remote data/ has the database before overwriting
    _, out, _ = ssh.exec_command(f"test -f {DEPLOY_DIR}/data/cam.db && echo OK || echo MISSING")
    if "MISSING" in out.read().decode():
        print("    WARNING: Remote data/cam.db not found — data may be lost already.")
    sync_files(ssh, DEPLOY_DIR)
    print("    Done.")

    # 3 — build + restart
    step(3, TOTAL, "Building and restarting on server...")
    ok = run_remote(
        ssh,
        f"""
set -euo pipefail
cd {DEPLOY_DIR}

if [ ! -d "{host_rec}" ]; then
  echo "    WARNING: {host_rec} not found — creating placeholder dir."
  mkdir -p "{host_rec}"
fi

podman build -f docker/Dockerfile -t camera-event-manager:latest . 2>&1 | tail -4
podman rm -f camera-event-manager 2>/dev/null || true
podman run -d --name camera-event-manager --restart=always \\
  -p 8080:8080 \\
  -p 8555:8555 \\
  -v {DEPLOY_DIR}/data:/opt/camera-event-manager/data \\
  -v {host_rec}:{container_rec} \\
  --env-file {DEPLOY_DIR}/.env \\
  -e GO2RTC_WEBRTC_CANDIDATE={hostname}:8555 \\
  localhost/camera-event-manager:latest
""",
    )
    ssh.close()
    if not ok:
        sys.exit("ERROR: Remote build/start failed.")

    # 4 — health
    step(4, TOTAL, "Health check...")
    for i in range(1, 13):
        try:
            with urlopen(f"{app_url}/api/v1/health", timeout=5) as r:
                if b'"ok"' in r.read():
                    print(f"    Live at {app_url}")
                    return
        except URLError, OSError:
            pass
        print(f"    Waiting ({i}/12)...")
        time.sleep(5)
    sys.exit("ERROR: Health check timed out.")


if __name__ == "__main__":
    main()
