#!/usr/bin/env python3
"""Bounded CDC-11 reference load measurement on the target VPS.

Creates test orders through the existing Store API checkout script. This does
not change analytical authority or deliberately stop any service.
"""

import argparse
import json
import re
import statistics
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SOURCE = "medusa_reference-postgres-1"
BACKEND = "medusa_reference-backend-1"
SLOT_NAMES = (
    "funnelmetry_cdc_catalog_shadow",
    "funnelmetry_cdc_inventory_price_shadow_v2",
    "funnelmetry_cdc_order_v2_e1",
)
PIPELINE_SERVICE = "funnelmetry_vps_live_postgres"
FACT_TOPIC = "cdc_shadow_reference.order_recorded_state.v2"
ORDER = re.compile(r"shadow_order=(order_[A-Za-z0-9]+)")


def run(command, *, input_text=None, timeout=120):
    result = subprocess.run(command, input=input_text, capture_output=True,
                            text=True, timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError(f"command failed: {command[0]} (exit {result.returncode})")
    return result.stdout.strip()


def pipeline_container():
    ids = run(["docker", "ps", "-q", "--filter",
               f"label=com.docker.swarm.service.name={PIPELINE_SERVICE}"]).splitlines()
    if len(ids) != 1 or not re.fullmatch(r"[a-f0-9]{12,64}", ids[0]):
        raise RuntimeError("target Pipeline PostgreSQL task is not unique")
    return ids[0]


def sql(container, user, database, statement):
    return run(["docker", "exec", "-i", container, "psql", "-X", "-U", user,
                "-d", database, "-At", "-v", "ON_ERROR_STOP=1"],
               input_text=statement)


def source_state():
    statement = """SELECT json_build_object(
      'orders',(SELECT count(*) FROM public.order),
      'slots',(SELECT COALESCE(json_object_agg(slot_name,json_build_object(
        'status',wal_status,'active',active,
        'retained_bytes',pg_wal_lsn_diff(pg_current_wal_lsn(),restart_lsn)::bigint,
        'safe_wal_bytes',safe_wal_size)),'{}'::json)
        FROM pg_replication_slots WHERE slot_name IN
        ('funnelmetry_cdc_catalog_shadow',
         'funnelmetry_cdc_inventory_price_shadow_v2',
         'funnelmetry_cdc_order_v2_e1')),
      'pg_wal_bytes',(SELECT COALESCE(sum(size),0) FROM pg_ls_waldir()))::text;"""
    return json.loads(sql(SOURCE, "medusa", "medusa", statement))


def sink_state(container, from_offset=None):
    statement = f"""SELECT json_build_object(
      'next_offset',(SELECT next_offset FROM reference_cdc_v2_sink_offsets
        WHERE fact_topic='{FACT_TOPIC}' AND partition=0),
      'transition_count',(SELECT count(*) FROM reference_cdc_v2_record_inbox
        WHERE record_type='TRANSITION' AND fact_topic='{FACT_TOPIC}'),
      'new_lag_seconds',(SELECT COALESCE(json_agg(EXTRACT(EPOCH FROM
        (ingested_at-(payload->>'observed_state_at')::timestamptz))
        ORDER BY kafka_offset),'[]'::json) FROM reference_cdc_v2_record_inbox
        WHERE record_type='TRANSITION' AND fact_topic='{FACT_TOPIC}'
          AND kafka_offset>={int(from_offset or 9223372036854775807)}
          AND payload->>'observed_state_at' IS NOT NULL))::text;"""
    return json.loads(sql(container, "funnelmetry", "funnelmetry_handoff", statement))


def checkout(key_id):
    start = time.monotonic()
    output = run(["python3", str(ROOT / "checkout-target-shadow.py"),
                  "--postgres-container", SOURCE, "--backend-container", BACKEND,
                  "--publishable-key-id", key_id,
                  "--acknowledge-live-reference-order"], timeout=180)
    match = ORDER.search(output)
    if not match or "completion_type=order" not in output:
        raise RuntimeError("Store API checkout did not return an order")
    return match.group(1), time.monotonic() - start


def samples_until(stop, observations):
    while not stop.is_set():
        try:
            state = source_state()
            resources = run(["docker", "stats", "--no-stream", "--format",
                             "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.BlockIO}}"],
                            timeout=30)
            observations.append({"source": state, "resources": [
                line for line in resources.splitlines() if line.startswith(
                    ("medusa_reference-postgres-1|", "medusa_reference-backend-1|",
                     "funnelmetry_cdc_target_shadow_", "funnelmetry_vps_live_kafka."))]})
        except (RuntimeError, ValueError, subprocess.TimeoutExpired):
            observations.append({"sample_error": True})
        stop.wait(5)


def percentile(values, percentile_value):
    return round(statistics.quantiles(values, n=100, method="inclusive")[
        percentile_value - 1], 3) if len(values) > 1 else round(values[0], 3)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--orders", type=int, default=12)
    parser.add_argument("--parallelism", type=int, default=2)
    parser.add_argument("--publishable-key-id", required=True)
    parser.add_argument("--acknowledge-live-reference-orders", action="store_true")
    args = parser.parse_args()
    if not args.acknowledge_live_reference_orders or not 1 <= args.orders <= 120 or \
            not 1 <= args.parallelism <= 3 or args.parallelism > args.orders or \
            not re.fullmatch(r"apk_[A-Za-z0-9]+", args.publishable_key_id):
        parser.error("target acknowledgement, 1..120 orders, 1..3 workers and key ID required")
    pipeline = pipeline_container()
    before_source = source_state()
    before_sink = sink_state(pipeline)
    if set(before_source["slots"]) != set(SLOT_NAMES) or any(
            slot["status"] not in ("reserved", "extended") or not slot["active"] or
            int(slot["safe_wal_bytes"] or 0) < 512 * 1024 * 1024
            for slot in before_source["slots"].values()):
        raise RuntimeError("CDC slots are not active with at least 512 MiB headroom")
    stop = threading.Event()
    observations = []
    sampler = threading.Thread(target=samples_until, args=(stop, observations), daemon=True)
    sampler.start()
    started = time.monotonic()
    try:
        with ThreadPoolExecutor(max_workers=args.parallelism) as workers:
            results = [future.result() for future in as_completed(
                [workers.submit(checkout, args.publishable_key_id)
                 for _ in range(args.orders)])]
        checkout_done = time.monotonic()
    finally:
        stop.set()
        sampler.join(timeout=35)
    ids = [order_id for order_id, _ in results]
    if len(set(ids)) != args.orders:
        raise RuntimeError("test order IDs are not unique")
    deadline = time.monotonic() + 180
    while True:
        after_source = source_state()
        after_sink = sink_state(pipeline, before_sink["next_offset"])
        if (after_source["orders"] == before_source["orders"] + args.orders and
            after_sink["transition_count"] == before_sink["transition_count"] + args.orders and
            after_sink["next_offset"] == before_sink["next_offset"] + args.orders * 2):
            break
        if time.monotonic() > deadline:
            raise RuntimeError("source/order CDC sink did not catch up within 180 seconds")
        time.sleep(3)
    lag = [float(value) for value in after_sink["new_lag_seconds"]]
    if len(lag) != args.orders:
        raise RuntimeError("expected one measured ON transition per test order")
    slots = [item["source"]["slots"] for item in observations if "source" in item]
    resources = {}
    for item in observations:
        for line in item.get("resources", []):
            name, cpu, memory, block_io = line.split("|", 3)
            resources[name] = {"max_cpu_percent": max(float(cpu.rstrip("%")),
                resources.get(name, {}).get("max_cpu_percent", 0)),
                "last_memory": memory, "last_block_io": block_io}
    print(json.dumps({"status": "PASS_BOUNDED_REFERENCE_SAMPLE",
        "orders": args.orders, "parallelism": args.parallelism,
        "checkout_seconds": round(checkout_done - started, 3),
        "throughput_orders_per_second": round(args.orders / (checkout_done - started), 3),
        "checkout_p95_seconds": percentile([seconds for _, seconds in results], 95),
        "checkout_p99_seconds": percentile([seconds for _, seconds in results], 99),
        "catchup_after_checkout_seconds": round(time.monotonic() - checkout_done, 3),
        "end_to_sink_p95_seconds": percentile(lag, 95),
        "end_to_sink_p99_seconds": percentile(lag, 99),
        "source_order_count_before": before_source["orders"],
        "source_order_count_after": after_source["orders"],
        "sink_offset_before": before_sink["next_offset"],
        "sink_offset_after": after_sink["next_offset"],
        "min_safe_wal_bytes": {name: min(
            s[name]["safe_wal_bytes"] for s in slots) for name in SLOT_NAMES},
        "max_retained_wal_bytes": {name: max(
            s[name]["retained_bytes"] for s in slots) for name in SLOT_NAMES},
        "max_pg_wal_bytes": max((item["source"]["pg_wal_bytes"] for item in
                                 observations if "source" in item), default=None),
        "sample_count": len(observations),
        "sample_errors": sum("sample_error" in item for item in observations),
        "resource_samples": resources}, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired) as error:
        raise SystemExit(f"cdc-target-bounded-load: {error}") from None
