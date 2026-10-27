#!/usr/bin/env python3
"""Create mode-600 credentials for the isolated reference projection only."""

import os
import secrets
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PRIVATE = ROOT / "private"
PRIVATE.mkdir(mode=0o700, exist_ok=True)
os.chmod(PRIVATE, 0o700)
DB_ENV = PRIVATE / "reference-projection-db.env"
MAPPER_ENV = PRIVATE / "reference-mapper.env"

if DB_ENV.exists() or MAPPER_ENV.exists():
    if not (DB_ENV.exists() and MAPPER_ENV.exists()):
        raise SystemExit("partial reference mapper credentials; inspect before retrying")
    if any(path.stat().st_mode & 0o077 for path in (DB_ENV, MAPPER_ENV)):
        raise SystemExit("unsafe reference mapper credential permissions")
    print("preserved reference mapper credentials")
    raise SystemExit(0)

password = secrets.token_hex(24)
fields = {
    DB_ENV: (
        "POSTGRES_DB=reference_projection\n"
        "POSTGRES_USER=reference_mapper\n"
        f"POSTGRES_PASSWORD={password}\n"
    ),
    MAPPER_ENV: (
        f"DATABASE_URL=postgres://reference_mapper:{password}@reference-projection-db:5432/reference_projection\n"
        "KAFKA_BROKERS=kafka:9092\n"
        "KAFKA_GROUP_ID=cdc-shadow-reference-mapper-v1\n"
        "SOURCE_INSTANCE_ID=medusa-reference-shadow\n"
        "FACT_TOPIC=cdc_shadow_reference.order_recorded_state.v1\n"
    ),
}
for path, content in fields.items():
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        stream.write(content)
    print(f"created {path.name}")
