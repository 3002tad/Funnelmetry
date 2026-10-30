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


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "target_order_quality", ROOT / "verify-target-order-quality.py")
target = importlib.util.module_from_spec(spec)
spec.loader.exec_module(target)
quality = target.quality
PREFIX = "cdc_shadow_medusa_order_v2_e1"
FACT = "cdc_shadow_reference.order_recorded_state.v2"


def sample(args):
    topics = [*(f"{PREFIX}.public.{table}" for table in quality.TABLES),
              f"{PREFIX}.transaction", FACT]
    # Read source last. New source rows are allowed to be pending in the
    # projection, but existing source rows must have equal state.
    mapper = target.mapper_state(args.mapper_container, "cdc11_order_epoch1")
    sink = target.sink_state(args.pipeline_container, "cdc11_order_epoch1", FACT)
    ends = read_topic_ends(args.kafka_container, topics)
    connector = target.connector_running(args.connect_container)
    source = target.source_state(args.source_container, "funnelmetry_cdc_order_v2_e1")
    return {"source": source, "mapper": mapper, "sink": sink,
            "topic_ends": ends, "connector_running": connector}


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
        value = sample(args)
        result = quality.evaluate_moving(value, prefix=PREFIX, fact_topic=FACT,
            minimum_safe_wal_bytes=256 * 1024 * 1024,
            max_pending_orders=args.max_pending_orders,
            max_raw_offset_lag=args.max_raw_offset_lag,
            max_pending_seconds=args.max_pending_seconds,
            pending_first_seen=pending_first_seen, now_seconds=time.monotonic())
        pending_first_seen = result["pending_first_seen"]
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
