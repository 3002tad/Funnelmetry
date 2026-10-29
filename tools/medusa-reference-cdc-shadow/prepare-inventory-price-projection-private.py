#!/usr/bin/env python3
"""Create isolated stage-2 projector credentials without printing values."""

import os
import re
import secrets
from pathlib import Path


root = Path(__file__).resolve().parent / "private"
epoch = os.environ.get("CDC_COVERAGE_EPOCH", "")
if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", epoch):
    raise SystemExit("set a distinct CDC_COVERAGE_EPOCH for this isolated clone")
if not root.is_dir() or root.is_symlink() or root.stat().st_mode & 0o077:
    raise SystemExit("prepare the mode-700 shadow private directory first")
database = root / "inventory-price-projection-db.env"
projector = root / "inventory-price-projector.env"
if any(path.exists() or path.is_symlink() for path in (database, projector)):
    raise SystemExit("inventory/price projection credentials already exist; refusing overwrite")
password = secrets.token_hex(24)
values = {
    database: ("POSTGRES_DB=inventory_price_projection\n"
               "POSTGRES_USER=inventory_price_projection\n"
               f"POSTGRES_PASSWORD={password}\n"),
    projector: ("DATABASE_URL=postgres://inventory_price_projection:"
                f"{password}@inventory-price-projection-db:5432/inventory_price_projection\n"
                "KAFKA_BROKERS=kafka:9092\n"
                "KAFKA_GROUP_ID=cdc-shadow-inventory-price-projector-v1\n"
                "CDC_TOPIC_PREFIX=cdc_shadow_medusa_inventory_price\n"
                f"CDC_COVERAGE_EPOCH={epoch}\n"
                "SOURCE_ID=medusa-reference\n"),
}
for path, content in values.items():
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        stream.write(content)
print("inventory/price projection credentials created in private/ (mode 600)")
