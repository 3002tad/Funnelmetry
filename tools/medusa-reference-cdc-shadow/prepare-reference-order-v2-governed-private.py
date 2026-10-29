#!/usr/bin/env python3
"""Create non-secret settings for the isolated reference v2 sink candidate."""

import os
from pathlib import Path


root = Path(__file__).resolve().parent / "private"
if not root.is_dir() or root.is_symlink() or root.stat().st_mode & 0o077:
    raise SystemExit("prepare the mode-700 shadow private directory first")
target = root / "reference-order-v2-governed-sink.env"
if target.exists() or target.is_symlink():
    raise SystemExit("candidate settings already exist; refusing overwrite")
if os.environ.get("COMPOSE_PROJECT_NAME") != "funnelmetry_cdc_shadow_cdc10":
    raise SystemExit("requires the isolated CDC-10 clone project")
content = ("REFERENCE_CDC_MODE=SHADOW_ONLY\n"
           "SOURCE_INSTANCE_ID=medusa-reference-shadow\n"
           "COVERAGE_EPOCH_ID=cdc10-epoch2\n"
           "FACT_TOPIC=cdc_shadow_reference.order_recorded_state.v2\n"
           "KAFKA_GROUP_ID=cdc-shadow-governed-reference-v2-epoch2\n"
           "KAFKA_BROKERS=kafka:9092\n")
fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w", encoding="utf-8") as stream:
    stream.write(content)
print("reference order v2 candidate settings created in private/ (mode 600)")
