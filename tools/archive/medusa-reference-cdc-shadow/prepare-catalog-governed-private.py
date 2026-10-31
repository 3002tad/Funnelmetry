#!/usr/bin/env python3
"""Create non-secret candidate writer settings in a protected shadow env file."""

import os
import re
from pathlib import Path


root = Path(__file__).resolve().parent / "private"
if not root.is_dir() or root.is_symlink() or root.stat().st_mode & 0o077:
    raise SystemExit("prepare the mode-700 shadow private directory first")
target = root / "catalog-governed-writer.env"
if target.exists() or target.is_symlink():
    raise SystemExit("candidate writer settings already exist; refusing overwrite")
epoch = os.environ.get("CATALOG_CDC_COVERAGE_EPOCH", "")
if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", epoch):
    raise SystemExit("set a distinct CATALOG_CDC_COVERAGE_EPOCH")
content = ("CATALOG_CDC_SOURCE_ID=medusa-reference\n"
           f"CATALOG_CDC_COVERAGE_EPOCH={epoch}\n"
           "CATALOG_CDC_TOPIC_PREFIX=cdc_shadow_medusa_catalog\n"
           f"CATALOG_CDC_GROUP_ID=cdc-shadow-governed-catalog-{epoch}\n"
           "KAFKA_BOOTSTRAP_SERVERS=kafka:9092\n")
fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w", encoding="utf-8") as stream:
    stream.write(content)
print("candidate writer settings created in private/ (mode 600)")
