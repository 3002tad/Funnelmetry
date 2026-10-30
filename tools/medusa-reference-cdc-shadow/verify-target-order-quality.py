#!/usr/bin/env python3
"""Read-only source/mapper/sink quality gate for target CDC-11 order v2.

Uses the same pure semantic evaluator as the isolated clone. This probe does
not publish a lease or activate a funnel/read path.
"""

import argparse
import concurrent.futures
import importlib.util
import json
import re
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("order_v2_quality", ROOT / "reference_order_v2_quality.py")
quality = importlib.util.module_from_spec(spec)
spec.loader.exec_module(quality)


def run(command, stdin=None):
    result = subprocess.run(command, input=stdin, text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError(f"target order quality command failed (exit {result.returncode})")
    return result.stdout.strip()


def sql(container, user, db, statement):
    output = run(["docker", "exec", "-i", container, "psql", "-X", "-U", user,
                  "-d", db, "-At", "-v", "ON_ERROR_STOP=1"], statement)
    return json.loads(output)


def topic_end(container, topic):
    output = run(["docker", "exec", container, "/opt/kafka/bin/kafka-get-offsets.sh",
                  "--bootstrap-server", "kafka:9092", "--topic", topic])
    lines = [line for line in output.splitlines() if line.startswith(topic + ":0:")]
    if len(lines) != 1:
        raise ValueError("order quality topic has no exact partition-0 end")
    return int(lines[0].rsplit(":", 1)[1])


def source_state(container, slot):
    return sql(container, "medusa", "medusa", f"""SELECT json_build_object(
      'states',(SELECT COALESCE(json_agg(json_build_object('order_id',o.id,
        'active',o.deleted_at IS NULL AND q.cart_count=1,
        'cart_id',CASE WHEN o.deleted_at IS NULL AND q.cart_count=1 THEN q.cart_id
          ELSE NULL END) ORDER BY o.id),'[]'::json)
        FROM public."order" o CROSS JOIN LATERAL
          (SELECT count(DISTINCT oc.cart_id) AS cart_count,min(oc.cart_id) AS cart_id
           FROM public.order_cart oc JOIN public.cart c ON c.id=oc.cart_id
             AND c.completed_at IS NOT NULL WHERE oc.order_id=o.id) q),
      'ambiguous_orders',(SELECT count(*) FROM public."order" o WHERE
        (SELECT count(DISTINCT oc.cart_id) FROM public.order_cart oc
          JOIN public.cart c ON c.id=oc.cart_id AND c.completed_at IS NOT NULL
          WHERE oc.order_id=o.id)>1),
      'slot_status',(SELECT wal_status FROM pg_replication_slots
        WHERE slot_name='{slot}'),
      'slot_safe_wal_size',(SELECT safe_wal_size FROM pg_replication_slots
        WHERE slot_name='{slot}'))::text;""")


def mapper_state(container, epoch):
    return sql(container, "reference_cdc_mapper", "reference_cdc_mapper", f"""SELECT json_build_object(
      'epoch',(SELECT json_build_object('status',status,'snapshot_last_seen',snapshot_last_seen,
        'baseline_active_count',baseline_active_count,'previous_epoch_gap',previous_epoch_gap,
        'baseline_digest',baseline_digest) FROM reference_cdc_v2_epochs
        WHERE coverage_epoch_id='{epoch}'),
      'states',(SELECT COALESCE(json_agg(json_build_object('order_id',order_id,
        'cart_id',cart_id,'active',active) ORDER BY order_id),'[]'::json)
        FROM reference_cdc_v2_state),
      'outbox_counts',(SELECT COALESCE(json_object_agg(record_type,n),'{{}}'::json)
        FROM (SELECT record_type,count(*) n FROM reference_cdc_v2_outbox GROUP BY record_type) x),
      'unpublished',(SELECT count(*) FROM reference_cdc_v2_outbox WHERE published_at IS NULL),
      'pending_ends',(SELECT count(*) FROM reference_cdc_v2_ends WHERE processed_at IS NULL),
      'offsets',(SELECT COALESCE(json_object_agg(topic,next_offset),'{{}}'::json)
        FROM reference_cdc_v2_input_offsets WHERE partition=0))::text;""")


def sink_state(container, epoch, fact_topic):
    return sql(container, "funnelmetry", "funnelmetry_handoff", f"""SELECT json_build_object(
      'states',(SELECT COALESCE(json_agg(json_build_object('order_id',order_id,
        'cart_id',cart_id,'active',active) ORDER BY order_id),'[]'::json)
        FROM reference_cdc_v2_order_current_state
        WHERE source_instance_id='medusa-reference' AND coverage_epoch_id='{epoch}'),
      'inbox_counts',(SELECT COALESCE(json_object_agg(record_type,n),'{{}}'::json)
        FROM (SELECT record_type,count(*) n FROM reference_cdc_v2_record_inbox
          WHERE source_instance_id='medusa-reference' AND coverage_epoch_id='{epoch}'
          GROUP BY record_type) x),
      'offset',(SELECT next_offset FROM reference_cdc_v2_sink_offsets
        WHERE fact_topic='{fact_topic}' AND partition=0),
      'quality',(SELECT json_build_object('status',status,'baseline_complete',baseline_complete,
        'baseline_orders',baseline_orders,'baseline_active_orders',baseline_active_orders,
        'baseline_digest',baseline_digest,'historical_gap_status',historical_gap_status)
        FROM reference_cdc_v2_quality_state
        WHERE source_instance_id='medusa-reference' AND coverage_epoch_id='{epoch}'))::text;""")


def connector_running(container):
    output = run(["docker", "exec", container, "curl", "-fsS", "--max-time", "10",
        "http://127.0.0.1:8083/connectors/medusa-cdc-order-v2-shadow-e1/status"])
    state = json.loads(output)
    return state.get("connector", {}).get("state") == "RUNNING" and bool(state.get("tasks")) and all(
        task.get("state") == "RUNNING" for task in state["tasks"])


def sample(args):
    prefix = "cdc_shadow_medusa_order_v2_e1"
    fact_topic = "cdc_shadow_reference.order_recorded_state.v2"
    topics = [*(f"{prefix}.public.{table}" for table in quality.TABLES),
              f"{prefix}.transaction", fact_topic]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        ends = dict(zip(topics, executor.map(lambda topic: topic_end(args.kafka_container, topic), topics)))
    return {"source": source_state(args.source_container, "funnelmetry_cdc_order_v2_e1"),
            "mapper": mapper_state(args.mapper_container, "cdc11_order_epoch1"),
            "sink": sink_state(args.pipeline_container, "cdc11_order_epoch1", fact_topic),
            "topic_ends": ends,
            "connector_running": connector_running(args.connect_container)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-container", required=True)
    parser.add_argument("--mapper-container", required=True)
    parser.add_argument("--pipeline-container", required=True)
    parser.add_argument("--kafka-container", required=True)
    parser.add_argument("--connect-container", required=True)
    args = parser.parse_args()
    if args.source_container != "medusa_reference-postgres-1" or any(
            not re.fullmatch(r"[a-f0-9]{12,64}", value) for value in
            (args.mapper_container, args.pipeline_container, args.kafka_container,
             args.connect_container)):
        raise ValueError("explicit CDC-11 container IDs required")
    prefix = "cdc_shadow_medusa_order_v2_e1"
    fact_topic = "cdc_shadow_reference.order_recorded_state.v2"
    first_sample = sample(args)
    first = quality.evaluate(first_sample, prefix=prefix, fact_topic=fact_topic,
                             minimum_safe_wal_bytes=256 * 1024 * 1024)
    time.sleep(1)
    second_sample = sample(args)
    second = quality.evaluate(second_sample, prefix=prefix, fact_topic=fact_topic,
                              minimum_safe_wal_bytes=256 * 1024 * 1024)
    stable = first["status"] == second["status"] == "PASS" and \
        first["source_digest"] == second["source_digest"] and \
        first["mapper_digest"] == second["mapper_digest"] and \
        first["sink_digest"] == second["sink_digest"] and \
        first_sample["topic_ends"] == second_sample["topic_ends"]
    second["checks"]["stable_two_samples"] = stable
    second["status"] = "PASS_SHADOW_POINT_IN_TIME" if stable else "BLOCKED_BY_QUALITY"
    second["continuous_lease"] = "NOT_ESTABLISHED"
    second["live_binding"] = "UNCHANGED"
    print(json.dumps(second, sort_keys=True))
    if not stable:
        raise SystemExit(1)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"cdc-target-order-quality: {error}") from None
