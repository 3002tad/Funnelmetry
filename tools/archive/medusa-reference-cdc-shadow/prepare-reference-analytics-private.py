#!/usr/bin/env python3
"""Create isolated, mode-600 shadow analytical sink credentials."""

import os
import secrets
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PRIVATE = ROOT / "private"
PRIVATE.mkdir(mode=0o700, exist_ok=True)
os.chmod(PRIVATE, 0o700)
DB_ENV = PRIVATE / "reference-analytics-db.env"
SINK_ENV = PRIVATE / "reference-analytics-sink.env"

if DB_ENV.exists() or SINK_ENV.exists():
    if not (DB_ENV.exists() and SINK_ENV.exists()):
        raise SystemExit("partial analytical sink credentials; inspect before retrying")
    if any(path.stat().st_mode & 0o077 for path in (DB_ENV, SINK_ENV)):
        raise SystemExit("unsafe analytical sink credential permissions")
    print("preserved analytical sink credentials")
    raise SystemExit(0)

password = secrets.token_hex(24)
fields = {
    DB_ENV: (
        "POSTGRES_DB=reference_analytics\n"
        "POSTGRES_USER=reference_analytics\n"
        f"POSTGRES_PASSWORD={password}\n"
    ),
    SINK_ENV: (
        f"DATABASE_URL=postgres://reference_analytics:{password}@reference-analytics-db:5432/reference_analytics\n"
        "KAFKA_BROKERS=kafka:9092\n"
        "KAFKA_GROUP_ID=cdc-shadow-reference-analytics-v1\n"
        "FACT_TOPIC=cdc_shadow_reference.order_recorded_state.v1\n"
    ),
}
for path, content in fields.items():
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        stream.write(content)
    print(f"created {path.name}")
