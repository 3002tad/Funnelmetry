#!/usr/bin/env python3
"""Create separate catalog projection DB/consumer secrets for a shadow clone."""

import os
import secrets
from pathlib import Path


root = Path(__file__).resolve().parent / "private"
if not root.is_dir() or root.is_symlink() or root.stat().st_mode & 0o077:
    raise SystemExit("prepare the mode-700 shadow private directory first")
files = (root / "catalog-projection-db.env", root / "catalog-projector.env")
if any(path.exists() or path.is_symlink() for path in files):
    raise SystemExit("catalog projection secret already exists; refusing overwrite")
password = secrets.token_hex(24)
content = (
    f"POSTGRES_USER=catalog_projection\nPOSTGRES_PASSWORD={password}\nPOSTGRES_DB=catalog_projection\n",
    "DATABASE_URL="
    f"postgres://catalog_projection:{password}@catalog-projection-db:5432/catalog_projection\n"
    "KAFKA_BROKERS=kafka:9092\n"
    "KAFKA_GROUP_ID=cdc-shadow-catalog-projector-v1\n"
    "CDC_TOPIC_PREFIX=cdc_shadow_medusa_catalog\n"
    "SOURCE_ID=medusa-reference\n",
)
created = []
try:
    for path, text in zip(files, content):
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        created.append(path)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(text)
except BaseException:
    for path in created:
        path.unlink(missing_ok=True)
    raise
print("catalog projection secrets created in private/ (mode 600)")
