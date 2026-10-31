#!/usr/bin/env python3
"""Create the isolated catalog CDC replication secret without printing it."""

import os
import secrets
from pathlib import Path


root = Path(__file__).resolve().parent / "private"
if not root.is_dir() or root.is_symlink() or root.stat().st_mode & 0o077:
    raise SystemExit("prepare the mode-700 shadow private directory first")
target = root / "catalog-connector.env"
if target.exists() or target.is_symlink():
    raise SystemExit("catalog connector secret already exists; refusing overwrite")
password = secrets.token_hex(24)
line = ("FUNNELMETRY_CDC_CATALOG_DATABASE_URL="
        f"postgres://cdc_catalog:{password}@postgres:5432/medusa\n")
fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w", encoding="utf-8") as stream:
    stream.write(line)
print("catalog connector secret created in private/ (mode 600)")
