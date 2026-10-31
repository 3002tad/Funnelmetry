#!/usr/bin/env python3
"""Reconcile an isolated order-v2 CDC chain and optionally issue a short lease.

This probe is deliberately limited to the shadow Compose project. It does not
publish live metadata or alter the existing order.placed analytical profile.
"""

import argparse
import importlib.util
import json
import os
import re
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("order_v2_quality", ROOT / "reference_order_v2_quality.py")
quality_core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(quality_core)
BASE = ["docker", "compose", "-f", str(ROOT / "compose.yml")]
MAPPER = BASE + ["-f", str(ROOT / "compose.reference-order-v2-mapper-candidate.yml")]
CHAIN = BASE + ["-f", str(ROOT / "compose.reference-order-v2-chain-candidate.yml")]


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def run(command, statement=None):
    result = subprocess.run(command, input=statement, text=True, capture_output=True, check=False)
    if result.returncode:
        detail = " | ".join(result.stderr.strip().splitlines()[-3:])[:240]
        raise RuntimeError(f"shadow command failed ({result.returncode}): {detail}")
    return result.stdout.strip()


def sql(compose, service, user, database, statement):
    output = run(compose + ["exec", "-T", service, "psql", "-X", "-U", user,
                            "-d", database, "-At", "-v", "ON_ERROR_STOP=1"], statement)
    rows = [line for line in output.splitlines() if line.startswith("{")]
    if len(rows) != 1:
        raise RuntimeError("expected one JSON row from shadow database")
    return json.loads(rows[0])


def source(slot):
    return sql(BASE, "postgres", "medusa", "medusa", f"""
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT json_build_object(
 'states', (SELECT COALESCE(json_agg(json_build_object('order_id',o.id,
   'active',o.deleted_at IS NULL AND q.cart_count=1,
   'cart_id',CASE WHEN o.deleted_at IS NULL AND q.cart_count=1 THEN q.cart_id
     ELSE NULL END) ORDER BY o.id),'[]'::json)
   FROM public."order" o CROSS JOIN LATERAL
     (SELECT count(DISTINCT oc.cart_id) AS cart_count,min(oc.cart_id) AS cart_id
      FROM public.order_cart oc JOIN public.cart c ON c.id=oc.cart_id
       AND c.completed_at IS NOT NULL WHERE oc.order_id=o.id) q),
 'ambiguous_orders', (SELECT count(*) FROM public."order" o WHERE
   (SELECT count(DISTINCT oc.cart_id) FROM public.order_cart oc
     JOIN public.cart c ON c.id=oc.cart_id AND c.completed_at IS NOT NULL
     WHERE oc.order_id=o.id)>1),
 'slot_status', (SELECT wal_status FROM pg_replication_slots
   WHERE slot_name={literal(slot)}),
 'slot_safe_wal_size', (SELECT safe_wal_size FROM pg_replication_slots
   WHERE slot_name={literal(slot)}))::text;
COMMIT;
""")


def mapper(epoch):
    return sql(MAPPER, "reference-order-v2-mapper-db", "reference_v2_mapper",
               "reference_v2_mapper", f"""
SELECT json_build_object(
 'epoch', (SELECT json_build_object('status',status,'snapshot_last_seen',snapshot_last_seen,
   'baseline_active_count',baseline_active_count,'previous_epoch_gap',previous_epoch_gap,
   'baseline_digest',baseline_digest) FROM reference_cdc_v2_epochs
   WHERE coverage_epoch_id={literal(epoch)}),
 'states', (SELECT COALESCE(json_agg(json_build_object('order_id',order_id,
   'cart_id',cart_id,'active',active) ORDER BY order_id),'[]'::json)
   FROM reference_cdc_v2_state),
 'outbox_counts', (SELECT COALESCE(json_object_agg(record_type,n),'{{}}'::json)
   FROM (SELECT record_type,count(*) n FROM reference_cdc_v2_outbox GROUP BY record_type) x),
 'unpublished', (SELECT count(*) FROM reference_cdc_v2_outbox WHERE published_at IS NULL),
 'pending_ends', (SELECT count(*) FROM reference_cdc_v2_ends WHERE processed_at IS NULL),
 'offsets', (SELECT COALESCE(json_object_agg(topic,next_offset),'{{}}'::json)
   FROM reference_cdc_v2_input_offsets WHERE partition=0))::text;
""")


def sink(epoch, source_id, fact_topic):
    return sql(CHAIN, "reference-order-v2-chain-db", "reference_v2_chain",
               "reference_v2_chain", f"""
SELECT json_build_object(
 'states', (SELECT COALESCE(json_agg(json_build_object('order_id',order_id,
   'cart_id',cart_id,'active',active) ORDER BY order_id),'[]'::json)
   FROM reference_cdc_v2_order_current_state
   WHERE source_instance_id={literal(source_id)} AND coverage_epoch_id={literal(epoch)}),
 'inbox_counts', (SELECT COALESCE(json_object_agg(record_type,n),'{{}}'::json)
   FROM (SELECT record_type,count(*) n FROM reference_cdc_v2_record_inbox
     WHERE source_instance_id={literal(source_id)} AND coverage_epoch_id={literal(epoch)}
     GROUP BY record_type) x),
 'offset', (SELECT next_offset FROM reference_cdc_v2_sink_offsets
   WHERE fact_topic={literal(fact_topic)} AND partition=0),
 'quality', (SELECT json_build_object('status',status,'baseline_complete',baseline_complete,
   'baseline_orders',baseline_orders,'baseline_active_orders',baseline_active_orders,
   'baseline_digest',baseline_digest,'historical_gap_status',historical_gap_status)
   FROM reference_cdc_v2_quality_state
   WHERE source_instance_id={literal(source_id)} AND coverage_epoch_id={literal(epoch)}))::text;
""")


def topic_end(topic):
    output = run(BASE + ["exec", "-T", "kafka", "/opt/kafka/bin/kafka-get-offsets.sh",
                         "--bootstrap-server", "kafka:9092", "--topic", topic])
    lines = [line for line in output.splitlines() if line.startswith(topic + ":0:")]
    if len(lines) != 1:
        raise RuntimeError("expected one partition for shadow topic")
    return int(lines[0].rsplit(":", 1)[1])


def connector_running(name):
    output = run(BASE + ["exec", "-T", "connect", "curl", "-fsS", "--max-time", "10",
                         f"http://127.0.0.1:8083/connectors/{name}/status"])
    state = json.loads(output)
    return state.get("connector", {}).get("state") == "RUNNING" and bool(state.get("tasks")) and all(
        task.get("state") == "RUNNING" for task in state["tasks"])


def sample(args):
    topics = [*(f"{args.prefix}.public.{table}" for table in quality_core.TABLES),
              f"{args.prefix}.transaction", args.fact_topic]
    return {"source": source(args.slot), "mapper": mapper(args.epoch),
            "sink": sink(args.epoch, args.source_id, args.fact_topic),
            "topic_ends": {topic: topic_end(topic) for topic in topics},
            "connector_running": connector_running(args.connector)}


def write_quality(args, result):
    status = "CURRENT_STATE_READY" if result["status"] == "PASS" else "BLOCKED_BY_QUALITY"
    reason = "SOURCE_MAPPER_SINK_RECONCILED" if status == "CURRENT_STATE_READY" else "RECONCILIATION_FAILED"
    expected = result["fact_offset"] if status == "CURRENT_STATE_READY" else None
    # The sink locks this same offset row before applying a new fact, and also
    # invalidates the quality row in that transaction. A stale probe cannot
    # publish a lease after the sink has moved past the sampled fact prefix.
    gate = (f"AND (SELECT next_offset FROM reference_cdc_v2_sink_offsets WHERE "
            f"fact_topic={literal(args.fact_topic)} AND partition=0)={expected} "
            f"AND baseline_complete AND baseline_digest={literal(result['baseline_digest'])}"
            if status == "CURRENT_STATE_READY" else "")
    statement = f"""
BEGIN;
SELECT next_offset FROM reference_cdc_v2_sink_offsets
 WHERE fact_topic={literal(args.fact_topic)} AND partition=0 FOR UPDATE;
UPDATE reference_cdc_v2_quality_state SET status={literal(status)},reason={literal(reason)},
 verified_at=CASE WHEN {literal(status)}='CURRENT_STATE_READY' THEN clock_timestamp() ELSE NULL END,
 valid_until=CASE WHEN {literal(status)}='CURRENT_STATE_READY'
  THEN clock_timestamp()+make_interval(secs=>{args.lease_seconds}) ELSE NULL END
 WHERE source_instance_id={literal(args.source_id)} AND coverage_epoch_id={literal(args.epoch)}
 {gate};
COMMIT;
"""
    output = run(CHAIN + ["exec", "-T", "reference-order-v2-chain-db", "psql", "-X",
                          "-U", "reference_v2_chain", "-d", "reference_v2_chain",
                          "-v", "ON_ERROR_STOP=1"], statement)
    if "UPDATE 1" not in output.splitlines():
        raise RuntimeError("quality row missing or sampled sink offset became stale")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("epoch", "source-id", "slot", "connector", "prefix", "fact-topic"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--minimum-safe-wal-bytes", type=int, default=64 * 1024 * 1024)
    parser.add_argument("--lease-seconds", type=int, default=45)
    parser.add_argument("--write-quality", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"funnelmetry_cdc_shadow_[a-z0-9_-]+", os.environ.get("COMPOSE_PROJECT_NAME", "")):
        parser.error("requires an isolated shadow Compose project")
    for name in ("epoch", "source_id", "slot", "connector", "prefix", "fact_topic"):
        if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}", getattr(args, name)):
            parser.error(f"invalid {name}")
    if not 5 <= args.lease_seconds <= 120 or args.minimum_safe_wal_bytes < 1:
        parser.error("lease or WAL threshold outside candidate bounds")
    try:
        first_sample = sample(args)
        first = quality_core.evaluate(first_sample, prefix=args.prefix, fact_topic=args.fact_topic,
                                      minimum_safe_wal_bytes=args.minimum_safe_wal_bytes)
        time.sleep(1)
        second_sample = sample(args)
        second = quality_core.evaluate(second_sample, prefix=args.prefix, fact_topic=args.fact_topic,
                                       minimum_safe_wal_bytes=args.minimum_safe_wal_bytes)
    except (RuntimeError, OSError, ValueError, TypeError, subprocess.TimeoutExpired):
        if args.write_quality:
            # An unavailable source, Connect or Kafka must not leave a prior
            # readiness lease open when the sink database is still reachable.
            try:
                write_quality(args, {"status": "BLOCKED_BY_QUALITY", "fact_offset": None})
            except (RuntimeError, OSError, ValueError):
                pass  # The old bounded lease still expires if the sink is down.
        raise
    stable = (first["status"] == second["status"] == "PASS" and
              first["source_digest"] == second["source_digest"] and
              first["mapper_digest"] == second["mapper_digest"] and
              first["sink_digest"] == second["sink_digest"] and
              first_sample["topic_ends"] == second_sample["topic_ends"])
    if not stable:
        second["status"] = "BLOCKED_BY_QUALITY"
        second["checks"]["stable_two_samples"] = False
    else:
        second["checks"]["stable_two_samples"] = True
    second["baseline_digest"] = (second_sample["sink"].get("quality") or {}).get("baseline_digest")
    if args.write_quality:
        write_quality(args, second)
    print(json.dumps(second, sort_keys=True))
    return 0 if stable else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, OSError, ValueError, TypeError, subprocess.TimeoutExpired) as error:
        raise SystemExit(f"order-v2-quality: {error}") from None
