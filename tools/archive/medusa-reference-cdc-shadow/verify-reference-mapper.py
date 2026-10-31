#!/usr/bin/env python3
"""Read-only conformance check for the isolated durable reference mapper."""

import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent
BASE = ["docker", "compose", "-f", str(ROOT / "compose.yml")]
MAPPER = BASE + ["-f", str(ROOT / "compose.reference-mapper.yml")]


def run(command, stdin=None):
    result = subprocess.run(command, input=stdin, text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError(result.stderr[-500:] or f"command failed: {command[0]}")
    return result.stdout.strip()


def sql(service, statement, overlay=False):
    command = (MAPPER if overlay else BASE) + [
        "exec", "-T", service, "psql", "-X", "-U",
        "reference_mapper" if overlay else "medusa", "-d",
        "reference_projection" if overlay else "medusa", "-At", "-v", "ON_ERROR_STOP=1",
    ]
    return run(command, statement)


rows = json.loads(sql("reference-projection-db", """
SELECT COALESCE(json_agg(json_build_object('order_id',order_id,'active',active)
  ORDER BY order_id),'[]'::json)::text FROM fact_state;
""", overlay=True))
source_ids = [item["order_id"] for item in rows]
if not source_ids or any(not value.startswith("order_") or not value[6:].isalnum() for value in source_ids):
    raise RuntimeError("no valid projected shadow order IDs")
array = ",".join("'" + value + "'" for value in source_ids)
db_rows = json.loads(sql("postgres", f"""
SELECT COALESCE(json_agg(json_build_object('order_id',id,'active',
  deleted_at IS NULL AND EXISTS (SELECT 1 FROM public.order_cart oc
    JOIN public.cart c ON c.id=oc.cart_id AND c.completed_at IS NOT NULL
    WHERE oc.order_id=o.id)) ORDER BY id),'[]'::json)::text
FROM public."order" o WHERE id IN ({array});
"""))
expected = {item["order_id"]: item["active"] for item in db_rows}
state_mismatches = [item["order_id"] for item in rows
                    if item["active"] != expected.get(item["order_id"], False)]

outbox = json.loads(sql("reference-projection-db", """
SELECT COALESCE(json_agg(payload ORDER BY seq),'[]'::json)::text FROM fact_outbox;
""", overlay=True))
pending = int(sql("reference-projection-db", "SELECT count(*) FROM fact_outbox WHERE published_at IS NULL;", overlay=True))
unprocessed = int(sql("reference-projection-db", "SELECT count(*) FROM cdc_ends WHERE processed_at IS NULL;", overlay=True))
if not outbox:
    raise RuntimeError("no shadow facts to verify")

topic = "cdc_shadow_reference.order_recorded_state.v1"
offsets = run(BASE + ["exec", "-T", "kafka", "/opt/kafka/bin/kafka-get-offsets.sh",
                      "--bootstrap-server", "kafka:9092", "--topic", topic]).splitlines()
if len(offsets) != 1 or not offsets[0].startswith(f"{topic}:0:"):
    raise RuntimeError("expected one shadow fact topic partition")
kafka_records = int(offsets[0].rsplit(":", 1)[1])
if kafka_records < len(outbox):
    raise RuntimeError("Kafka fact topic has fewer records than the outbox")
raw = run(BASE + ["exec", "-T", "kafka", "/opt/kafka/bin/kafka-console-consumer.sh",
                  "--bootstrap-server", "kafka:9092", "--topic", topic,
                  "--from-beginning", "--max-messages", str(kafka_records), "--timeout-ms", "10000"])
messages = [json.loads(line) for line in raw.splitlines() if line]
outbox_by_id = {item["fact_change_id"]: item for item in outbox}
topic_by_id = {item["fact_change_id"]: item for item in messages}
if len(outbox_by_id) != len(outbox):
    raise RuntimeError("duplicate logical fact change IDs in outbox")
if set(topic_by_id) != set(outbox_by_id) or any(
    item != outbox_by_id[item["fact_change_id"]] for item in messages
):
    raise RuntimeError("Kafka topic and outbox fact contents differ")

result = {
    "status": "PASS" if not state_mismatches and not pending and not unprocessed else "FAIL",
    "projected_orders": len(rows),
    "active_orders": sum(item["active"] for item in rows),
    "state_mismatches": state_mismatches,
    "outbox_facts": len(outbox),
    "kafka_records": len(messages),
    "unique_kafka_facts": len(topic_by_id),
    "duplicate_deliveries": len(messages) - len(topic_by_id),
    "pending_outbox": pending,
    "unprocessed_ends": unprocessed,
}
print(json.dumps(result, sort_keys=True))
if result["status"] != "PASS":
    raise SystemExit(1)
