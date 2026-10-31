#!/usr/bin/env python3
"""Publish one exact duplicate of a shadow reference fact for sink dedup testing."""

import json
import os
import subprocess
from pathlib import Path

if os.environ.get("SHADOW_DUPLICATE_FACT_PROBE") != "1":
    raise SystemExit("set SHADOW_DUPLICATE_FACT_PROBE=1 for this isolated shadow test")

root = Path(__file__).resolve().parent
base = ["docker", "compose", "-f", str(root / "compose.yml")]
analytics = base + ["-f", str(root / "compose.reference-analytics.yml")]
query = "SELECT payload::text FROM reference_fact_changes ORDER BY kafka_offset LIMIT 1;"
read = subprocess.run(
    analytics + ["exec", "-T", "reference-analytics-db", "psql", "-X", "-U",
                 "reference_analytics", "-d", "reference_analytics", "-At", "-v", "ON_ERROR_STOP=1", "-c", query],
    capture_output=True, text=True, check=True,
)
lines = read.stdout.strip().splitlines()
if len(lines) != 1:
    raise SystemExit("expected one shadow reference fact")
fact = json.loads(lines[0])
if fact.get("contract_id") != "reference.medusa.order_recorded_state.v1" or fact.get("source_instance_id") != "medusa-reference-shadow":
    raise SystemExit("refusing to duplicate non-shadow fact")
allowed = {"contract_id", "source_instance_id", "fact_change_id", "order_id", "cart_id",
           "active", "revision_end_id", "observed_state_at", "quality", "coverage"}
if set(fact) != allowed:
    raise SystemExit("refusing unexpected reference fact payload fields")

producer = subprocess.run(
    base + ["exec", "-T", "kafka", "/opt/kafka/bin/kafka-console-producer.sh",
            "--bootstrap-server", "kafka:9092", "--topic", "cdc_shadow_reference.order_recorded_state.v1"],
    input=lines[0] + "\n", capture_output=True, text=True, check=False,
)
if producer.returncode:
    raise SystemExit(producer.stderr[-400:])
print("published one exact duplicate shadow fact for downstream idempotency probe")
