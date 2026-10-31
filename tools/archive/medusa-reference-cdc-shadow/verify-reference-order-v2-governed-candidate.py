#!/usr/bin/env python3
"""Compare the new Pipeline-style order v2 sink with the pinned clone sink."""

import json
import os
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
BASE = ["docker", "compose", "-f", str(ROOT / "compose.yml"),
        "-f", str(ROOT / "compose.recovery-epoch.yml"),
        "-f", str(ROOT / "compose.reference-order-v2-governed-candidate.yml")]
TOPIC = "cdc_shadow_reference.order_recorded_state.v2"
SOURCE = "medusa-reference-shadow"
EPOCH = "cdc10-epoch2"


def run(command, sql=None):
    result = subprocess.run(command, input=sql, text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError("isolated order v2 candidate command failed")
    return result.stdout.strip()


def query(statement):
    output = run(BASE + ["exec", "-T", "recovery-analytics-db", "psql", "-X",
                         "-U", "recovery_analytics", "-d", "recovery_analytics", "-At",
                         "-v", "ON_ERROR_STOP=1"], statement)
    return json.loads(output)


def state():
    return query("""
SELECT json_build_object(
 'candidate_offset', (SELECT next_offset FROM reference_cdc_v2_sink_offsets
   WHERE fact_topic='cdc_shadow_reference.order_recorded_state.v2' AND partition=0),
 'old_offset', (SELECT next_offset FROM recovery_sink_offsets
   WHERE topic='cdc_shadow_reference.order_recorded_state.v2' AND partition=0),
 'candidate_counts', (SELECT COALESCE(json_object_agg(record_type,n),'{}'::json)
   FROM (SELECT record_type,count(*) AS n FROM reference_cdc_v2_record_inbox
     WHERE source_instance_id='medusa-reference-shadow' AND coverage_epoch_id='cdc10-epoch2'
     GROUP BY record_type) x),
 'old_counts', (SELECT COALESCE(json_object_agg(record_type,n),'{}'::json)
   FROM (SELECT record_type,count(*) AS n FROM recovery_record_inbox
     WHERE source_instance_id='medusa-reference-shadow' AND coverage_epoch_id='cdc10-epoch2'
     GROUP BY record_type) x),
 'candidate_states', (SELECT COALESCE(json_agg(json_build_object('order_id',order_id,
   'cart_id',cart_id,'active',active) ORDER BY order_id),'[]'::json)
   FROM reference_cdc_v2_order_current_state WHERE source_instance_id='medusa-reference-shadow'
   AND coverage_epoch_id='cdc10-epoch2'),
 'old_states', (SELECT COALESCE(json_agg(json_build_object('order_id',order_id,
   'cart_id',cart_id,'active',active) ORDER BY order_id),'[]'::json)
   FROM recovery_order_current_state WHERE source_instance_id='medusa-reference-shadow'
   AND coverage_epoch_id='cdc10-epoch2'),
 'candidate_quality', (SELECT json_build_object('status',status,
   'baseline_complete',baseline_complete,'baseline_orders',baseline_orders,
   'baseline_active_orders',baseline_active_orders)
   FROM reference_cdc_v2_quality_state WHERE source_instance_id='medusa-reference-shadow'
   AND coverage_epoch_id='cdc10-epoch2'),
 'readable_count', (SELECT count(*) FROM reference_cdc_v2_order_current_state_readable)
)::text;
""")


def topic_end():
    output = run(BASE + ["exec", "-T", "kafka", "/opt/kafka/bin/kafka-get-offsets.sh",
                         "--bootstrap-server", "kafka:9092", "--topic", TOPIC])
    lines = [line for line in output.splitlines() if line.startswith(TOPIC + ":0:")]
    if len(lines) != 1:
        raise RuntimeError("candidate topic has unexpected partitions")
    return int(lines[0].rsplit(":", 1)[1])


def main():
    if os.environ.get("COMPOSE_PROJECT_NAME") != "funnelmetry_cdc_shadow_cdc10":
        raise RuntimeError("requires exact isolated CDC-10 clone project")
    deadline = time.monotonic() + 120
    end = topic_end()
    while True:
        item = state()
        matched = (int(item["candidate_offset"] or 0) == end and
                   int(item["old_offset"] or 0) == end and
                   item["candidate_counts"] == item["old_counts"] and
                   item["candidate_states"] == item["old_states"] and
                   item["candidate_quality"]["baseline_complete"] is True and
                   item["candidate_quality"]["status"] == "BLOCKED_BY_QUALITY" and
                   item["readable_count"] == 0)
        if matched or time.monotonic() >= deadline:
            result = {"status": "PASS_SHADOW_SINK" if matched else "BLOCKED_BY_QUALITY",
                      "topic_end": end, "candidate_offset": item["candidate_offset"],
                      "old_offset": item["old_offset"],
                      "candidate_counts": item["candidate_counts"],
                      "old_counts": item["old_counts"],
                      "candidate_state_count": len(item["candidate_states"]),
                      "old_state_count": len(item["old_states"]),
                      "baseline_complete": item["candidate_quality"]["baseline_complete"],
                      "readable_count": item["readable_count"]}
            print(json.dumps(result, sort_keys=True))
            return 0 if matched else 1
        time.sleep(5)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, OSError, TypeError) as error:
        raise SystemExit(f"reference-order-v2-governed-verifier: {error}") from None
