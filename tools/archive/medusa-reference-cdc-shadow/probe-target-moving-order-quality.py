#!/usr/bin/env python3
"""Read-only bounded-lag order quality probe on the CDC-11 target.

Unlike the strict quiescent verifier, this samples mapper/sink before source,
so newly committed source orders may be pending. It never writes a lease.
"""

import argparse
import importlib.util
import json
import re
import time
from pathlib import Path

from target_kafka_offsets import read_topic_ends
from target_shadow_workers import worker_ids, assert_same


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "target_order_quality", ROOT / "verify-target-order-quality.py")
target = importlib.util.module_from_spec(spec)
spec.loader.exec_module(target)
quality = target.quality
PREFIX = "cdc_shadow_medusa_order_v2_e1"
FACT = "cdc_shadow_reference.order_recorded_state.v2"
SOURCE_ID = "medusa-reference"
EPOCH = "cdc11_order_epoch1"


def sample(args):
    workers = worker_ids(("order_mapper", "order_sink"))
    topics = [*(f"{PREFIX}.public.{table}" for table in quality.TABLES),
              f"{PREFIX}.transaction", FACT]
    # Read source last. New source rows are allowed to be pending in the
    # projection, but existing source rows must have equal state.
    mapper = target.mapper_state(args.mapper_container, "cdc11_order_epoch1")
    sink = target.sink_state(args.pipeline_container, "cdc11_order_epoch1", FACT)
    ends = read_topic_ends(args.kafka_container, topics)
    connector = target.connector_running(args.connect_container)
    source = target.source_state(args.source_container, "funnelmetry_cdc_order_v2_e1")
    assert_same(workers, ("order_mapper", "order_sink"))
    return {"source": source, "mapper": mapper, "sink": sink,
            "topic_ends": ends, "connector_running": connector}


def read_pending(container):
    return target.sql(container, "funnelmetry", "funnelmetry_handoff", """
      SELECT COALESCE(json_object_agg(order_id,
        EXTRACT(EPOCH FROM first_observed_at)),'{}'::json)::text
      FROM reference_cdc_v2_pending_quality_candidate
      WHERE source_instance_id='medusa-reference'
        AND coverage_epoch_id='cdc11_order_epoch1';""")


def write_pending(container, pending, observed_at):
    if any(not re.fullmatch(r"order_[A-Za-z0-9]+", order_id) or
           not isinstance(first, (int, float)) or first > observed_at
           for order_id, first in pending.items()):
        raise ValueError("invalid pending quality evidence")
    rows = json.dumps([{"order_id": order_id, "first_seconds": first}
                       for order_id, first in sorted(pending.items())],
                      separators=(",", ":"))
    # Only the candidate pending-age table changes. LEAST preserves the first
    # observation even if a second monitor instance races with this one.
    statement = f"""BEGIN;
      SELECT pg_advisory_xact_lock(hashtext('cdc11-order-pending-quality'));
      DELETE FROM reference_cdc_v2_pending_quality_candidate
       WHERE source_instance_id='{SOURCE_ID}' AND coverage_epoch_id='{EPOCH}'
         AND order_id NOT IN (SELECT order_id FROM jsonb_to_recordset(
           '{rows}'::jsonb) AS x(order_id text,first_seconds double precision));
      INSERT INTO reference_cdc_v2_pending_quality_candidate
        (source_instance_id,coverage_epoch_id,order_id,first_observed_at,last_observed_at)
      SELECT '{SOURCE_ID}','{EPOCH}',x.order_id,
        to_timestamp(x.first_seconds),to_timestamp({observed_at})
      FROM jsonb_to_recordset('{rows}'::jsonb)
        AS x(order_id text,first_seconds double precision)
      ON CONFLICT(source_instance_id,coverage_epoch_id,order_id)
      DO UPDATE SET first_observed_at=LEAST(
        reference_cdc_v2_pending_quality_candidate.first_observed_at,
        EXCLUDED.first_observed_at),last_observed_at=EXCLUDED.last_observed_at;
      COMMIT;"""
    target.run(["docker", "exec", "-i", container, "psql", "-X", "-U",
                "funnelmetry", "-d", "funnelmetry_handoff", "-At",
                "-v", "ON_ERROR_STOP=1"], statement)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("source-container", "mapper-container", "pipeline-container",
                 "kafka-container", "connect-container"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--max-pending-orders", type=int, required=True)
    parser.add_argument("--max-raw-offset-lag", type=int, required=True)
    parser.add_argument("--max-pending-seconds", type=float, required=True)
    parser.add_argument("--iterations", type=int, default=1)
    parser.add_argument("--interval-seconds", type=float, default=1)
    parser.add_argument("--persist-pending-shadow", action="store_true")
    args = parser.parse_args()
    if (args.source_container != "medusa_reference-postgres-1" or any(
            not re.fullmatch(r"[a-f0-9]{12,64}", getattr(args, name)) for name in
            ("mapper_container", "pipeline_container", "kafka_container",
             "connect_container")) or not 1 <= args.iterations <= 20 or
            not 0 <= args.max_pending_orders <= 20 or
            not 0 <= args.max_raw_offset_lag <= 256 or
            not 0 < args.max_pending_seconds <= 60 or
            not 0 <= args.interval_seconds <= 10):
        parser.error("invalid target containers or bounded policy")
    pending_first_seen = {}
    failed = False
    for iteration in range(args.iterations):
        if args.persist_pending_shadow:
            pending_first_seen = {key: float(value) for key, value in
                                  read_pending(args.pipeline_container).items()}
        value = sample(args)
        observed_at = time.time() if args.persist_pending_shadow else time.monotonic()
        result = quality.evaluate_moving(value, prefix=PREFIX, fact_topic=FACT,
            minimum_safe_wal_bytes=256 * 1024 * 1024,
            max_pending_orders=args.max_pending_orders,
            max_raw_offset_lag=args.max_raw_offset_lag,
            max_pending_seconds=args.max_pending_seconds,
            pending_first_seen=pending_first_seen, now_seconds=observed_at)
        pending_first_seen = result["pending_first_seen"]
        if args.persist_pending_shadow and result["source_count"] is not None and \
                result["sink_count"] is not None and result["mapper_digest"] is not None:
            write_pending(args.pipeline_container, pending_first_seen, observed_at)
        failed |= result["status"] != "PASS_BOUNDED_LAG"
        print(json.dumps({"iteration": iteration + 1, "status": result["status"],
            "checks": result["checks"],
            "source_count": result["source_count"],
            "sink_count": result["sink_count"],
            "pending_order_count": result["pending_order_count"],
            "raw_offset_backlog": result["raw_offset_backlog"],
            "fact_offset": result["fact_offset"]}, sort_keys=True), flush=True)
        if iteration + 1 < args.iterations:
            time.sleep(args.interval_seconds)
    return 1 if failed else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, OSError, TypeError) as error:
        raise SystemExit(f"cdc-target-moving-order-quality: {error}") from None
