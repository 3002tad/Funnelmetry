#!/usr/bin/env python3
"""Create private settings for the isolated mapper-output -> sink chain."""

import os
import secrets
from pathlib import Path


root = Path(__file__).resolve().parent / "private"
if os.environ.get("COMPOSE_PROJECT_NAME") != "funnelmetry_cdc_shadow_cdc10":
    raise SystemExit("requires the isolated CDC-10 clone project")
if not root.is_dir() or root.is_symlink() or root.stat().st_mode & 0o077:
    raise SystemExit("prepare mode-700 shadow private directory first")
database = root / "reference-order-v2-chain-db.env"
sink = root / "reference-order-v2-chain-sink.env"
if any(path.exists() or path.is_symlink() for path in (database, sink)):
    raise SystemExit("chain candidate settings already exist; refusing overwrite")
password = secrets.token_hex(24)
values = {
    database: ("POSTGRES_DB=reference_v2_chain\n"
               "POSTGRES_USER=reference_v2_chain\n"
               f"POSTGRES_PASSWORD={password}\n"),
    sink: ("DATABASE_URL=postgres://reference_v2_chain:"
           f"{password}@reference-order-v2-chain-db:5432/reference_v2_chain\n"
           "REFERENCE_CDC_MODE=SHADOW_ONLY\n"
           "SOURCE_INSTANCE_ID=medusa-reference-shadow\n"
           "COVERAGE_EPOCH_ID=cdc10-epoch2\n"
           "FACT_TOPIC=cdc_shadow_reference.order_recorded_state.v2.governed_probe\n"
           "KAFKA_GROUP_ID=cdc-shadow-governed-reference-v2-chain-epoch2\n"
           "KAFKA_BROKERS=kafka:9092\n"),
}
for path, content in values.items():
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        stream.write(content)
print("reference order v2 chain candidate settings created in private/ (mode 600)")
