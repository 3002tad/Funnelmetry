#!/usr/bin/env python3
"""Bounded synthetic checkout and CDC catch-up measurement on the cdc10 clone."""

import argparse
import importlib.util
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
COMPOSE = ["docker", "compose", "-f", str(ROOT / "compose.yml")]
SPEC = importlib.util.spec_from_file_location("cdc_catchup", ROOT / "verify-cdc-catchup.py")
catchup = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(catchup)
ORDER = re.compile(r"shadow_order=(order_[A-Za-z0-9]+)")


def run(command, timeout=120):
    result = subprocess.run(command, capture_output=True, text=True,
                            timeout=timeout, check=False)
    if result.returncode:
        detail = (result.stdout + result.stderr)[-500:]
        detail = re.sub(r"apk_[A-Za-z0-9]+", "<redacted-key>", detail)
        raise RuntimeError(f"shadow command failed: {command[0]} {command[1]}; {detail}")
    return result.stdout.strip()


def checkout():
    start = time.monotonic()
    output = run(["python3", str(ROOT / "run-store-js.py"), "checkout-shadow.mjs"])
    match = ORDER.search(output)
    if not match or "completion_type=order" not in output:
        raise RuntimeError("synthetic checkout did not return an order")
    return match.group(1), time.monotonic() - start


def sample_resources(stop, samples):
    while not stop.is_set():
        try:
            output = run(["docker", "stats", "--no-stream", "--format",
                          "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}"], timeout=20)
            for line in output.splitlines():
                if line.startswith(PROJECT + "-"):
                    samples.append(line)
        except (RuntimeError, subprocess.TimeoutExpired):
            pass
        stop.wait(2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--orders", type=int, default=30)
    parser.add_argument("--parallelism", type=int, default=5)
    parser.add_argument("--pause-connect-for-workload", action="store_true")
    args = parser.parse_args()
    if os.environ.get("COMPOSE_PROJECT_NAME") != PROJECT:
        parser.error(f"COMPOSE_PROJECT_NAME must be exactly {PROJECT}")
    if not 1 <= args.orders <= 30 or not 1 <= args.parallelism <= 5:
        parser.error("orders must be 1..30 and parallelism 1..5")
    baseline_lsn = run(COMPOSE + ["exec", "-T", "postgres", "psql", "-X",
                                  "-U", "medusa", "-d", "medusa", "-At",
                                  "-c", "SELECT pg_current_wal_lsn();"])
    if args.pause_connect_for_workload:
        run(COMPOSE + ["stop", "connect"])
    samples = []
    stop = threading.Event()
    sampler = threading.Thread(target=sample_resources, args=(stop, samples), daemon=True)
    sampler.start()
    started = time.monotonic()
    try:
        with ThreadPoolExecutor(max_workers=args.parallelism) as executor:
            results = [future.result() for future in as_completed(
                [executor.submit(checkout) for _ in range(args.orders)])]
        workload_ended_at = time.monotonic()
    finally:
        stop.set()
        sampler.join(timeout=25)
        if args.pause_connect_for_workload:
            run(COMPOSE + ["start", "connect"])
    orders = [order for order, _ in results]
    if len(set(orders)) != args.orders:
        raise RuntimeError("synthetic checkout IDs are not unique")
    workload_seconds = workload_ended_at - started
    protected = ROOT / "private" / "cdc10-load-order-ids.json"
    fd = os.open(protected, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        json.dump(sorted(orders), stream)
    deadline = time.monotonic() + 300
    while True:
        gate = catchup.evaluate(catchup.observe(orders, baseline_lsn), len(orders))
        if gate["status"] == "PASS":
            break
        if time.monotonic() >= deadline:
            raise RuntimeError(f"CDC load did not catch up: "
                               f"{[key for key, passed in gate['checks'].items() if not passed]}")
        time.sleep(2)
    caught_up_seconds = time.monotonic() - started
    mapper = json.loads(run(["python3", str(ROOT / "verify-reference-mapper.py")], 180))
    sink = json.loads(run(["python3", str(ROOT / "verify-reference-analytics.py")], 180))
    if mapper.get("status") != "PASS" or sink.get("status") != "PASS":
        raise RuntimeError("shadow mapper/sink reconciliation failed")
    latencies = sorted(latency for _, latency in results)
    cpu = {}
    memory_mib = {}
    for line in samples:
        name, cpu_raw, memory_raw = line.split("|", 2)
        service = name.removeprefix(PROJECT + "-").rsplit("-", 1)[0]
        cpu[service] = max(cpu.get(service, 0), float(cpu_raw.rstrip("%")))
        used = memory_raw.split(" / ", 1)[0]
        number, unit = re.fullmatch(r"([0-9.]+)([KMG]iB)", used).groups()
        memory_mib[service] = max(memory_mib.get(service, 0),
                                  float(number) * {"KiB": 1 / 1024, "MiB": 1,
                                                   "GiB": 1024}[unit])
    print(json.dumps({"status": "PASS", "project": PROJECT,
                      "orders": len(orders), "parallelism": args.parallelism,
                      "connector_paused_during_checkout": args.pause_connect_for_workload,
                      "workload_seconds": round(workload_seconds, 2),
                      "throughput_orders_per_second": round(args.orders / workload_seconds, 3),
                      "checkout_p50_seconds": round(statistics.median(latencies), 2),
                      "checkout_p95_seconds": round(latencies[int(0.95 * (len(latencies)-1))], 2),
                      "batch_catchup_seconds_from_start": round(caught_up_seconds, 2),
                      "batch_catchup_seconds_after_workload": round(
                          caught_up_seconds - workload_seconds, 2),
                      "sampled_max_cpu_percent": cpu,
                      "sampled_max_memory_mib": memory_mib,
                      "resource_samples": len(samples), "source_gate": gate,
                      "mapper": mapper, "sink": sink}, sort_keys=True))


if __name__ == "__main__":
    raise SystemExit(main())
