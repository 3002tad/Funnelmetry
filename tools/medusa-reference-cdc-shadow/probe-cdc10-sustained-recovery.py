#!/usr/bin/env python3
"""Bounded sustained checkout/load probe for the isolated CDC-10 epoch-2 clone."""

import argparse
import json
import os
import re
import statistics
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PROJECT = "funnelmetry_cdc_shadow_cdc10"
BASE = ["docker", "compose", "-f", str(ROOT / "compose.yml")]
FULL = BASE + ["-f", str(ROOT / "compose.recovery-epoch.yml")]
ORDER = re.compile(r"shadow_order=(order_[A-Za-z0-9]+)")


def run(argv, timeout=120):
    result = subprocess.run(argv, capture_output=True, text=True, timeout=timeout,
                            check=False)
    if result.returncode:
        raise RuntimeError(f"bounded load command failed: {argv[0]} (exit {result.returncode})")
    return result.stdout.strip()


def verify(timeout=0):
    result = subprocess.run(["python3", str(ROOT / "verify-recovery-epoch.py"),
                             "--timeout-seconds", str(timeout)], capture_output=True,
                            text=True, timeout=max(60, timeout + 30), check=False)
    if result.returncode not in (0, 1) or not result.stdout.strip().startswith("{"):
        raise RuntimeError("recovery verifier execution failed")
    return json.loads(result.stdout)


def source_sql(statement):
    return run(BASE + ["exec", "-T", "postgres", "psql", "-X", "-U", "medusa",
                       "-d", "medusa", "-At", "-c", statement])


def analytics_sql(statement):
    return run(FULL + ["exec", "-T", "recovery-analytics-db", "psql", "-X",
                       "-U", "recovery_analytics", "-d", "recovery_analytics",
                       "-At", "-c", statement])


def checkout():
    started = time.monotonic()
    output = run(["python3", str(ROOT / "run-store-js.py"), "checkout-shadow.mjs"],
                 timeout=150)
    found = ORDER.search(output)
    if not found or "completion_type=order" not in output:
        raise RuntimeError("synthetic checkout returned no order")
    return found.group(1), time.monotonic() - started


def sample(stop, observations):
    while not stop.is_set():
        try:
            slot = source_sql("SELECT json_build_object('wal_status',wal_status,"
                "'retained',pg_wal_lsn_diff(pg_current_wal_lsn(),restart_lsn)::bigint,"
                "'safe_wal_size',safe_wal_size)::text FROM pg_replication_slots "
                "WHERE slot_name='funnelmetry_cdc10_epoch2';")
            resources = run(["docker", "stats", "--no-stream", "--format",
                "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}"], timeout=25)
            observations.append({"slot": json.loads(slot), "resources":
                [line for line in resources.splitlines() if line.startswith(PROJECT + "-")]})
        except (RuntimeError, ValueError, subprocess.TimeoutExpired):
            observations.append({"sample_error": True})
        stop.wait(5)


def percentile(values, proportion):
    ordered = sorted(values)
    return round(ordered[min(len(ordered) - 1, int(proportion * (len(ordered) - 1)))], 3)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--orders", type=int, default=120)
    parser.add_argument("--parallelism", type=int, default=5)
    args = parser.parse_args()
    if os.environ.get("COMPOSE_PROJECT_NAME") != PROJECT:
        parser.error("only the isolated CDC-10 clone may be loaded")
    if not 1 <= args.orders <= 150 or not 1 <= args.parallelism <= 5:
        parser.error("orders must be 1..150; parallelism 1..5")
    before = verify(60)
    if before["status"] != "PASS":
        raise RuntimeError("recovery epoch is not reconciled before load")
    baseline_transitions = before["transition_records"]
    stop = threading.Event()
    observations = []
    sampler = threading.Thread(target=sample, args=(stop, observations), daemon=True)
    sampler.start()
    started = time.monotonic()
    try:
        with ThreadPoolExecutor(max_workers=args.parallelism) as workers:
            results = [future.result() for future in as_completed(
                [workers.submit(checkout) for _ in range(args.orders)])]
        completed_at = time.monotonic()
    finally:
        stop.set()
        sampler.join(timeout=30)
    ids = [order_id for order_id, _ in results]
    if len(set(ids)) != args.orders:
        raise RuntimeError("duplicate synthetic checkout ID")
    deadline = time.monotonic() + 300
    while True:
        after = verify()
        if after["status"] == "PASS" and after["transition_records"] == baseline_transitions + args.orders:
            break
        if time.monotonic() >= deadline:
            raise RuntimeError("recovery did not catch up to every synthetic order")
        time.sleep(5)
    final_at = time.monotonic()
    latency = [seconds for _, seconds in results]
    slots = [value["slot"] for value in observations if "slot" in value]
    sampled_cpu = {}
    sampled_memory_mib = {}
    for observation in observations:
        for line in observation.get("resources", []):
            name, raw_cpu, raw_memory = line.split("|", 2)
            service = name.removeprefix(PROJECT + "-").rsplit("-", 1)[0]
            sampled_cpu[service] = max(sampled_cpu.get(service, 0), float(raw_cpu.rstrip("%")))
            used = raw_memory.split(" / ", 1)[0]
            match = re.fullmatch(r"([0-9.]+)([KMG]iB)", used)
            if match:
                sampled_memory_mib[service] = max(sampled_memory_mib.get(service, 0),
                    round(float(match[1]) * {"KiB": 1 / 1024, "MiB": 1,
                                             "GiB": 1024}[match[2]], 2))
    lag = analytics_sql("SELECT COALESCE(json_agg(lag ORDER BY lag),'[]'::json)::text "
        "FROM (SELECT EXTRACT(EPOCH FROM (ingested_at-"
        "(payload->>'observed_state_at')::timestamptz))::numeric AS lag "
        "FROM recovery_record_inbox WHERE record_type='TRANSITION' AND "
        f"kafka_offset >= {before['fact_topic_offset']} AND "
        "payload->>'observed_state_at' IS NOT NULL) x;")
    lags = [float(item) for item in json.loads(lag)]
    output = {
        "status": "PASS", "orders": args.orders, "parallelism": args.parallelism,
        "workload_seconds": round(completed_at - started, 3),
        "throughput_orders_per_second": round(args.orders / (completed_at - started), 3),
        "checkout_p95_seconds": percentile(latency, 0.95),
        "catchup_after_workload_seconds": round(final_at - completed_at, 3),
        "transition_count_before": baseline_transitions,
        "transition_count_after": after["transition_records"],
        "fact_topic_offset_after": after["fact_topic_offset"],
        "sink_offset_after": after["sink_next_offset"],
        "cdc_lag_p95_seconds": percentile(lags, 0.95) if lags else None,
        "cdc_lag_max_seconds": round(max(lags), 3) if lags else None,
        "wal_retained_max_bytes": max((s["retained"] for s in slots if s["retained"] is not None), default=None),
        "safe_wal_size_min_bytes": min((s["safe_wal_size"] for s in slots if s["safe_wal_size"] is not None), default=None),
        "slot_statuses": sorted(set(s["wal_status"] for s in slots)),
        "resource_samples": len(observations),
        "sample_errors": sum("sample_error" in value for value in observations),
        "sampled_max_cpu_percent": sampled_cpu,
        "sampled_max_memory_mib": sampled_memory_mib,
    }
    print(json.dumps(output, sort_keys=True))


if __name__ == "__main__":
    main()
