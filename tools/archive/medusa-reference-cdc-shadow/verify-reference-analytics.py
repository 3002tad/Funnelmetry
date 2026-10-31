#!/usr/bin/env python3
"""Read-only reconciliation of the shadow mapper, analytical sink, and metadata."""

import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parent
base = ["docker", "compose", "-f", str(root / "compose.yml")]


def sql(overlay, service, user, database, statement):
    result = subprocess.run(
        base + ["-f", str(root / overlay), "exec", "-T", service, "psql", "-X",
                "-U", user, "-d", database, "-At", "-v", "ON_ERROR_STOP=1"],
        input=statement, text=True, capture_output=True, check=False,
    )
    if result.returncode:
        raise RuntimeError(result.stderr[-500:])
    return result.stdout.strip()


def mapper(statement):
    return sql("compose.reference-mapper.yml", "reference-projection-db",
               "reference_mapper", "reference_projection", statement)


def analytics(statement):
    return sql("compose.reference-analytics.yml", "reference-analytics-db",
               "reference_analytics", "reference_analytics", statement)


mapper_states = json.loads(mapper("""
SELECT COALESCE(json_agg(json_build_object('source_instance_id','medusa-reference-shadow',
  'order_id',order_id,'cart_id',cart_id,'active',active) ORDER BY order_id),'[]'::json)::text
FROM fact_state;
"""))
sink_states = json.loads(analytics("""
SELECT COALESCE(json_agg(json_build_object('source_instance_id',source_instance_id,
  'order_id',order_id,'cart_id',cart_id,'active',active) ORDER BY order_id),'[]'::json)::text
FROM reference_order_current_state;
"""))
mapper_facts = json.loads(mapper("""
SELECT COALESCE(json_agg(payload ORDER BY seq),'[]'::json)::text FROM fact_outbox;
"""))
sink_facts = json.loads(analytics("""
SELECT COALESCE(json_agg(payload ORDER BY kafka_offset),'[]'::json)::text
FROM reference_fact_changes;
"""))
metadata = json.loads(analytics("""
SELECT definition::text FROM reference_semantic_catalog
WHERE catalog_id='cdc-shadow-reference-analytics' AND version='1.0.0';
"""))
current_count = int(analytics("""
SELECT count(*) FROM reference_order_current_state
WHERE source_instance_id='medusa-reference-shadow' AND active;
"""))
next_offset = int(analytics("""
SELECT next_offset FROM reference_sink_offsets
WHERE topic='cdc_shadow_reference.order_recorded_state.v1' AND partition=0;
"""))
offsets = subprocess.run(
    base + ["exec", "-T", "kafka", "/opt/kafka/bin/kafka-get-offsets.sh",
            "--bootstrap-server", "kafka:9092", "--topic",
            "cdc_shadow_reference.order_recorded_state.v1"],
    capture_output=True, text=True, check=True,
).stdout.strip().splitlines()
if len(offsets) != 1 or not offsets[0].startswith("cdc_shadow_reference.order_recorded_state.v1:0:"):
    raise RuntimeError("unexpected shadow fact topic partitioning")
latest_offset = int(offsets[0].rsplit(":", 1)[1])

metadata_ok = (
    metadata.get("status") == "SHADOW_ONLY"
    and metadata.get("pipeline_catalog_published") is False
    and metadata.get("asset", {}).get("grain") == ["source_instance_id", "order_id"]
    and metadata.get("asset", {}).get("relation") == "public.reference_order_current_state"
    and metadata.get("execution_binding", {}).get("relation") == "public.reference_order_current_state"
    and metadata.get("metric", {}).get("id") == "metric.reference_currently_recorded_order_count"
    and metadata.get("metric", {}).get("status") == "SHADOW_ONLY"
)
result = {
    "status": "PASS" if mapper_states == sink_states and mapper_facts == sink_facts
                        and current_count == sum(item["active"] for item in sink_states)
                        and next_offset == latest_offset and metadata_ok else "FAIL",
    "states": len(sink_states),
    "active_current_count": current_count,
    "unique_facts": len(sink_facts),
    "topic_end_offset": latest_offset,
    "sink_next_offset": next_offset,
    "metadata_version": metadata.get("version"),
    "metadata_status": metadata.get("status"),
}
print(json.dumps(result, sort_keys=True))
if result["status"] != "PASS":
    raise SystemExit(1)
