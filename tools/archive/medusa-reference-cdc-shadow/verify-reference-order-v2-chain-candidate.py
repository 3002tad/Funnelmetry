#!/usr/bin/env python3
"""Compare isolated raw CDC -> new mapper -> new sink with CDC-10 v2 evidence."""

import json
import os
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
BASE = ["docker", "compose", "-f", str(ROOT / "compose.yml")]
MAPPER = BASE + ["-f", str(ROOT / "compose.reference-order-v2-mapper-candidate.yml")]
CHAIN = BASE + ["-f", str(ROOT / "compose.reference-order-v2-chain-candidate.yml")]
FACT = "cdc_shadow_reference.order_recorded_state.v2.governed_probe"
EPOCH = "cdc10-epoch2"


def run(command, statement=None):
    result = subprocess.run(command, input=statement, text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError("isolated order v2 chain command failed")
    return result.stdout.strip()


def sql(compose, service, user, database, statement):
    output = run(compose + ["exec", "-T", service, "psql", "-X", "-U", user,
                            "-d", database, "-At", "-v", "ON_ERROR_STOP=1"], statement)
    return json.loads(output)


def topic_end(topic):
    output = run(BASE + ["exec", "-T", "kafka", "/opt/kafka/bin/kafka-get-offsets.sh",
                         "--bootstrap-server", "kafka:9092", "--topic", topic])
    lines = [line for line in output.splitlines() if line.startswith(topic + ":0:")]
    if len(lines) != 1:
        raise RuntimeError("missing or partitioned candidate topic")
    return int(lines[0].rsplit(":", 1)[1])


def mapper():
    return sql(MAPPER, "reference-order-v2-mapper-db", "reference_v2_mapper",
               "reference_v2_mapper", """
SELECT json_build_object(
 'epoch', (SELECT json_build_object('status',status,'snapshot_last_seen',snapshot_last_seen,
   'baseline_active_count',baseline_active_count,'previous_epoch_gap',previous_epoch_gap,
   'baseline_digest',baseline_digest) FROM reference_cdc_v2_epochs
   WHERE coverage_epoch_id='cdc10-epoch2'),
 'states', (SELECT COALESCE(json_agg(json_build_object('order_id',order_id,
   'cart_id',cart_id,'active',active) ORDER BY order_id),'[]'::json) FROM reference_cdc_v2_state),
 'outbox_counts', (SELECT COALESCE(json_object_agg(record_type,n),'{}'::json)
   FROM (SELECT record_type,count(*) n FROM reference_cdc_v2_outbox
   GROUP BY record_type) x),
 'unpublished', (SELECT count(*) FROM reference_cdc_v2_outbox WHERE published_at IS NULL),
 'pending_ends', (SELECT count(*) FROM reference_cdc_v2_ends WHERE processed_at IS NULL),
 'offsets', (SELECT COALESCE(json_object_agg(topic,next_offset),'{}'::json)
   FROM reference_cdc_v2_input_offsets WHERE partition=0))::text;
""")


def sink():
    return sql(CHAIN, "reference-order-v2-chain-db", "reference_v2_chain",
               "reference_v2_chain", """
SELECT json_build_object(
 'states', (SELECT COALESCE(json_agg(json_build_object('order_id',order_id,
   'cart_id',cart_id,'active',active) ORDER BY order_id),'[]'::json)
   FROM reference_cdc_v2_order_current_state WHERE source_instance_id='medusa-reference-shadow'
     AND coverage_epoch_id='cdc10-epoch2'),
 'inbox_counts', (SELECT COALESCE(json_object_agg(record_type,n),'{}'::json)
   FROM (SELECT record_type,count(*) n FROM reference_cdc_v2_record_inbox
   GROUP BY record_type) x),
 'offset', (SELECT next_offset FROM reference_cdc_v2_sink_offsets
   WHERE fact_topic='cdc_shadow_reference.order_recorded_state.v2.governed_probe'
     AND partition=0),
 'quality', (SELECT json_build_object('status',status,'baseline_complete',baseline_complete,
   'baseline_orders',baseline_orders,'baseline_active_orders',baseline_active_orders,
   'historical_gap_status',historical_gap_status) FROM reference_cdc_v2_quality_state
   WHERE source_instance_id='medusa-reference-shadow' AND coverage_epoch_id='cdc10-epoch2'),
 'readable_count', (SELECT count(*) FROM reference_cdc_v2_order_current_state_readable))::text;
""")


def main():
    if os.environ.get("COMPOSE_PROJECT_NAME") != "funnelmetry_cdc_shadow_cdc10":
        raise RuntimeError("requires exact isolated CDC-10 clone project")
    deadline = time.monotonic() + 120
    end = topic_end(FACT)
    while True:
        m, s = mapper(), sink()
        counts = {"BASELINE": 105, "BASELINE_COMPLETE": 1, "STATE": 303,
                  "TRANSITION": 303}
        matched = (end == 712 and int(s["offset"] or 0) == end and
                   m["outbox_counts"] == s["inbox_counts"] == counts and
                   m["states"] == s["states"] and len(s["states"]) == 408 and
                   m["epoch"]["status"] == "BASELINE_VERIFIED" and
                   m["epoch"]["baseline_active_count"] == 105 and
                   m["epoch"]["previous_epoch_gap"] == "INCOMPLETE" and
                   m["unpublished"] == m["pending_ends"] == 0 and
                   s["quality"] == {"status":"BLOCKED_BY_QUALITY",
                                     "baseline_complete":True,
                                     "baseline_orders":105,
                                     "baseline_active_orders":105,
                                     "historical_gap_status":"INCOMPLETE"} and
                   s["readable_count"] == 0)
        if matched or time.monotonic() >= deadline:
            print(json.dumps({"status":"PASS_SHADOW_CHAIN" if matched else "BLOCKED_BY_QUALITY",
                              "fact_topic_end":end, "sink_offset":s["offset"],
                              "mapper_outbox_counts":m["outbox_counts"],
                              "sink_inbox_counts":s["inbox_counts"],
                              "state_count":len(s["states"]),
                              "readable_count":s["readable_count"]},sort_keys=True))
            return 0 if matched else 1
        time.sleep(5)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, OSError, TypeError) as error:
        raise SystemExit(f"reference-order-v2-chain-verifier: {error}") from None
