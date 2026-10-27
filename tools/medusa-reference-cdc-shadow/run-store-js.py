#!/usr/bin/env python3
"""Execute a Store API probe inside the private backend container.

The cloned public publishable key is passed only to that process and never
printed or written to a repository file.
"""

import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
COMPOSE = ["docker", "compose", "-f", str(ROOT / "compose.yml")]
KEY_ID = os.environ.get("SHADOW_PUBLISHABLE_KEY_ID", "apk_01M5WHGEQSWBCQXF2QMR5HAH6P")
if not re.fullmatch(r"apk_[A-Za-z0-9]+", KEY_ID):
    raise SystemExit("invalid publishable key ID")

if len(sys.argv) != 2:
    raise SystemExit("usage: python3 run-store-js.py <JavaScript file>")
script_path = ROOT / sys.argv[1]
if script_path.resolve().parent != ROOT or not script_path.is_file():
    raise SystemExit("JavaScript file must be inside this tool directory")

query = f"SELECT token FROM api_key WHERE id='{KEY_ID}' AND type='publishable' AND revoked_at IS NULL AND deleted_at IS NULL;"
result = subprocess.run(
    COMPOSE + ["exec", "-T", "postgres", "psql", "-X", "-U", "medusa", "-d", "medusa", "-At", "-v", "ON_ERROR_STOP=1", "-c", query],
    text=True,
    capture_output=True,
    check=False,
)
if result.returncode or len(result.stdout.splitlines()) != 1:
    raise SystemExit("expected exactly one publishable key in the cloned shadow DB")
key = result.stdout.strip()
if not key or "\n" in key:
    raise SystemExit("invalid publishable key")

extra_env = []
for name in ("SHADOW_STOP_BEFORE_COMPLETE", "SHADOW_CART_ID"):
    if name in os.environ:
        extra_env += ["-e", f"{name}={os.environ[name]}"]

run = subprocess.run(
    COMPOSE + ["exec", "-T", "-e", f"SHADOW_PUBLISHABLE_KEY={key}"] + extra_env + ["backend", "node", "-"],
    input=script_path.read_text(encoding="utf-8"),
    text=True,
    check=False,
)
raise SystemExit(run.returncode)
