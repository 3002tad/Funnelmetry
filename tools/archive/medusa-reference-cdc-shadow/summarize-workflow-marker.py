#!/usr/bin/env python3
"""Redacted WAL/DB comparison for one synthetic cart's workflow executions."""

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
COMPOSE = ["docker", "compose", "-f", str(ROOT / "compose.yml")]
SAFE_COLUMNS = {"id", "workflow_id", "transaction_id", "run_id", "state", "created_at", "updated_at"}

if len(sys.argv) != 3 or not re.fullmatch(r"cart_[A-Za-z0-9]+", sys.argv[1]) or not re.fullmatch(r"order_[A-Za-z0-9]+", sys.argv[2]):
    raise SystemExit("usage: summarize-workflow-marker.py <synthetic_cart_id> <synthetic_order_id>")
cart_id, order_id = sys.argv[1:]

statement = f"""
SELECT w.id, w.state,
  (w.context::text LIKE '%{order_id}%') AS context_contains_order,
  w.transaction_id, w.run_id
FROM public.workflow_execution w
WHERE w.workflow_id='complete-cart' AND w.context #>> '{{data,payload,id}}'='{cart_id}'
ORDER BY w.created_at, w.id;
SELECT 'order_link=' || oc.order_id || ',exists=' || (o.id IS NOT NULL)::text
FROM public.order_cart oc LEFT JOIN public."order" o ON o.id=oc.order_id
WHERE oc.cart_id='{cart_id}' ORDER BY oc.created_at;
"""
db = subprocess.run(
    COMPOSE + ["exec", "-T", "postgres", "psql", "-X", "-U", "medusa", "-d", "medusa", "-At", "-F", "|", "-v", "ON_ERROR_STOP=1"],
    input=statement, text=True, capture_output=True, check=True,
)
rows = [line for line in db.stdout.splitlines() if line and not line.startswith("order_link=")]
ids = {row.split("|", 1)[0] for row in rows}
print("db_workflow_rows=", json.dumps(rows, separators=(",", ":")))
for line in db.stdout.splitlines():
    if line.startswith("order_link="):
        print("db_" + line)

consumer = subprocess.run(
    COMPOSE + ["exec", "-T", "kafka", "/opt/kafka/bin/kafka-console-consumer.sh",
               "--bootstrap-server", "kafka:9092", "--topic", "cdc_shadow_workflow.public.workflow_execution",
               "--from-beginning", "--timeout-ms", "10000", "--consumer-property", "isolation.level=read_committed"],
    text=True, capture_output=True, check=False,
)
if consumer.returncode not in (0, 1) or (consumer.returncode == 1 and "TimeoutException" not in consumer.stderr):
    raise SystemExit("workflow Kafka consumer failed")
transitions = []
for line in consumer.stdout.splitlines():
    if not line.startswith("{"):
        continue
    record = json.loads(line)
    after = record.get("after") or {}
    before = record.get("before") or {}
    if not set(after).issubset(SAFE_COLUMNS) or not set(before).issubset(SAFE_COLUMNS):
        raise SystemExit("workflow CDC record contains columns outside the privacy allowlist")
    row = after or before
    if row.get("id") not in ids:
        continue
    source = record.get("source") or {}
    transitions.append({
        "workflow_row_id": row.get("id"), "op": record.get("op"),
        "state": row.get("state"), "lsn": source.get("lsn"), "txId": source.get("txId"),
        "updated_at": row.get("updated_at"), "transaction": (record.get("transaction") or {}).get("id"),
    })
print("cdc_workflow_transitions=", json.dumps(transitions, separators=(",", ":")))
