#!/usr/bin/env python3
"""Create isolated, non-overwriting credentials for the epoch-4 mapper probe."""

import os
import secrets
from pathlib import Path


private = Path(__file__).resolve().parent / "private"
if private.is_symlink() or not private.is_dir() or private.stat().st_mode & 0o077:
    raise SystemExit("mode-700 private directory required")
db = private / "recovery4-projection-db.env"
mapper = private / "recovery4-mapper.env"
if any(path.exists() or path.is_symlink() for path in (db, mapper)):
    raise SystemExit("epoch-4 credentials already exist")
password = secrets.token_hex(24)
content = {
    db: f"POSTGRES_DB=recovery4_projection\nPOSTGRES_USER=recovery4_mapper\nPOSTGRES_PASSWORD={password}\n",
    mapper: (f"DATABASE_URL=postgres://recovery4_mapper:{password}@recovery4-projection-db:5432/recovery4_projection\n"
             "KAFKA_BROKERS=kafka:9092\nKAFKA_GROUP_ID=cdc-shadow-recovery-mapper-v2-epoch4\n"
             "SOURCE_INSTANCE_ID=medusa-reference-shadow\nCOVERAGE_EPOCH_ID=cdc10-epoch4\n"
             "FACT_TOPIC=cdc_shadow_reference.order_recorded_state.v2.epoch4\n"),
}
created = []
try:
    for path, value in content.items():
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        created.append(path)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(value)
except BaseException:
    for path in created:
        path.unlink(missing_ok=True)
    raise
print("epoch-4 mapper probe credentials created privately")
