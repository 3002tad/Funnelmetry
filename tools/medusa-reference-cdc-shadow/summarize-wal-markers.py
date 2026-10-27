#!/usr/bin/env python3
"""Read redacted shadow WAL-message evidence for one synthetic order."""

import base64
import json
import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
COMPOSE = ["docker", "compose", "-f", str(ROOT / "compose.yml")]
PREFIX = "funnelmetry.shadow-order-placed.v1"

if len(sys.argv) != 2 or not re.fullmatch(r"order_[A-Za-z0-9]+", sys.argv[1]):
    raise SystemExit("usage: summarize-wal-markers.py <synthetic_order_id>")
order_id = sys.argv[1]

result = subprocess.run(
    COMPOSE + [
        "exec", "-T", "kafka", "/opt/kafka/bin/kafka-console-consumer.sh",
        "--bootstrap-server", "kafka:9092", "--topic", "cdc_shadow_medusa.message",
        "--from-beginning", "--timeout-ms", "10000",
        "--consumer-property", "isolation.level=read_committed",
    ],
    text=True,
    capture_output=True,
    check=False,
)
if result.returncode not in (0, 1):
    raise SystemExit(f"Kafka shadow consumer failed (exit {result.returncode})")

matching = []
for line in result.stdout.splitlines():
    if not line.startswith("{"):
        continue
    record = json.loads(line)
    message = record.get("message") or {}
    if record.get("op") != "m" or message.get("prefix") != PREFIX:
        continue
    payload = json.loads(base64.b64decode(message["content"], validate=True))
    if payload.get("order_id") != order_id:
        continue
    source = record.get("source") or {}
    matching.append({
        "event_id": payload.get("event_id"),
        "source_event_type": payload.get("source_event_type"),
        "source_schema_version": payload.get("source_schema_version"),
        "order_id": payload.get("order_id"),
        "cart_id": payload.get("cart_id"),
        "occurred_at": payload.get("occurred_at"),
        "currency_code": payload.get("currency_code"),
        "total_amount": payload.get("total_amount"),
        "amount_unit": payload.get("amount_unit"),
        "amount_semantics": payload.get("amount_semantics"),
        "lsn": source.get("lsn"),
        "txId": source.get("txId"),
        "snapshot": source.get("snapshot"),
    })

print(f"wal_marker_count={len(matching)}")
for marker in matching:
    print("wal_marker=" + json.dumps(marker, separators=(",", ":")))
