#!/usr/bin/env python3
"""Create distinct mode-600 CDC-10 recovery mapper/sink credentials on the clone."""

import os
import secrets
from pathlib import Path


root = Path(__file__).resolve().parent / "private"
if root.is_symlink() or not root.is_dir() or root.stat().st_mode & 0o077:
    raise SystemExit("prepare a mode-700 private directory on the isolated clone")
files = [root / name for name in (
    "recovery-projection-db.env", "recovery-mapper.env",
    "recovery-analytics-db.env", "recovery-analytics-sink.env")]
if any(path.exists() or path.is_symlink() for path in files):
    raise SystemExit("recovery credentials already exist; refusing partial overwrite")
mapper_password, sink_password = secrets.token_hex(24), secrets.token_hex(24)
content = [
    f"POSTGRES_DB=recovery_projection\nPOSTGRES_USER=recovery_mapper\nPOSTGRES_PASSWORD={mapper_password}\n",
    (f"DATABASE_URL=postgres://recovery_mapper:{mapper_password}@recovery-projection-db:5432/recovery_projection\n"
     "KAFKA_BROKERS=kafka:9092\nKAFKA_GROUP_ID=cdc-shadow-recovery-mapper-v2\n"
     "SOURCE_INSTANCE_ID=medusa-reference-shadow\nCOVERAGE_EPOCH_ID=cdc10-epoch2\n"
     "FACT_TOPIC=cdc_shadow_reference.order_recorded_state.v2\n"),
    f"POSTGRES_DB=recovery_analytics\nPOSTGRES_USER=recovery_analytics\nPOSTGRES_PASSWORD={sink_password}\n",
    (f"DATABASE_URL=postgres://recovery_analytics:{sink_password}@recovery-analytics-db:5432/recovery_analytics\n"
     "KAFKA_BROKERS=kafka:9092\nKAFKA_GROUP_ID=cdc-shadow-recovery-analytics-v2\n"
     "COVERAGE_EPOCH_ID=cdc10-epoch2\nFACT_TOPIC=cdc_shadow_reference.order_recorded_state.v2\n"),
]
created = []
try:
    for path, value in zip(files, content):
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        created.append(path)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(value)
except BaseException:
    for path in created:
        path.unlink(missing_ok=True)
    raise
print("four isolated recovery credentials created (mode 600)")
