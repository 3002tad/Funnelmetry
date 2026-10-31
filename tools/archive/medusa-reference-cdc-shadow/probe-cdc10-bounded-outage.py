#!/usr/bin/env python3
"""Run a bounded Connect outage and synthetic checkout burst on an isolated clone.

The test intentionally uses the disposable cdc10 Compose project only. It
always attempts to restart Connect, including after a failed checkout.
"""

import argparse
import importlib.util
import json
import os
import re
import subprocess
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


def run(command, *, timeout=120):
    result = subprocess.run(command, capture_output=True, text=True,
                            timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError(f"shadow command failed: {command[0]} {command[1]}")
    return result.stdout.strip()


def source_sample():
    output = run(COMPOSE + ["exec", "-T", "postgres", "psql", "-X", "-U",
                            "medusa", "-d", "medusa", "-At", "-c", """
      SELECT json_build_object('slot_active',active,'wal_status',wal_status,
        'confirmed_lsn',confirmed_flush_lsn::text,
        'retained_wal_bytes',pg_wal_lsn_diff(pg_current_wal_lsn(),restart_lsn),
        'safe_wal_size_bytes',safe_wal_size,
        'physical_wal_bytes',(SELECT sum(size) FROM pg_ls_waldir()))::text
      FROM pg_replication_slots WHERE slot_name='funnelmetry_cdc_shadow';
    """])
    return json.loads(output)


def checkout():
    output = run(["python3", str(ROOT / "run-store-js.py"), "checkout-shadow.mjs"],
                 timeout=120)
    match = ORDER.search(output)
    if not match or "completion_type=order" not in output:
        raise RuntimeError("synthetic checkout did not return an order")
    return match.group(1)


def wait_for_catchup(order_ids, baseline_lsn, timeout_seconds):
    deadline = time.monotonic() + timeout_seconds
    while True:
        result = catchup.evaluate(catchup.observe(order_ids, baseline_lsn), len(order_ids))
        if result["status"] == "PASS":
            return result
        if time.monotonic() >= deadline:
            raise RuntimeError(f"CDC did not catch up; failed gates: "
                               f"{[key for key, value in result['checks'].items() if not value]}")
        time.sleep(3)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--orders", type=int, default=12)
    parser.add_argument("--parallelism", type=int, default=3)
    parser.add_argument("--outage-seconds", type=int, default=360)
    args = parser.parse_args()
    if os.environ.get("COMPOSE_PROJECT_NAME") != PROJECT:
        parser.error(f"COMPOSE_PROJECT_NAME must be exactly {PROJECT}")
    if not 1 <= args.orders <= 30 or not 1 <= args.parallelism <= 5:
        parser.error("orders must be 1..30 and parallelism 1..5")
    if not 60 <= args.outage_seconds <= 900:
        parser.error("outage duration must be 60..900 seconds")
    baseline_lsn = run(COMPOSE + ["exec", "-T", "postgres", "psql", "-X",
                                  "-U", "medusa", "-d", "medusa", "-At",
                                  "-c", "SELECT pg_current_wal_lsn();"])
    baseline = source_sample()
    orders = []
    stopped = False
    started_at = time.monotonic()
    try:
        run(COMPOSE + ["stop", "connect"])
        stopped = True
        with ThreadPoolExecutor(max_workers=args.parallelism) as executor:
            futures = [executor.submit(checkout) for _ in range(args.orders)]
            for future in as_completed(futures):
                orders.append(future.result())
        if len(set(orders)) != args.orders:
            raise RuntimeError("synthetic checkout IDs are not unique")
        protected = ROOT / "private" / "cdc10-order-ids.json"
        fd = os.open(protected, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(sorted(orders), stream)
        during = catchup.evaluate(catchup.observe(orders, baseline_lsn), len(orders))
        if during["status"] == "PASS":
            raise RuntimeError("CDC unexpectedly passed while Connect was stopped")
        print(json.dumps({"phase": "connect_stopped", "orders": len(orders),
                          "elapsed_seconds": round(time.monotonic() - started_at, 2),
                          "wal": source_sample(),
                          "failed_gates": [key for key, value in during["checks"].items()
                                           if not value]}, sort_keys=True), flush=True)
        while time.monotonic() - started_at < args.outage_seconds:
            time.sleep(min(30, args.outage_seconds - (time.monotonic() - started_at)))
            print(json.dumps({"phase": "outage_sample",
                              "elapsed_seconds": round(time.monotonic() - started_at, 2),
                              "wal": source_sample()}, sort_keys=True), flush=True)
        before_resume = source_sample()
    finally:
        if stopped:
            run(COMPOSE + ["start", "connect"])
    resumed_at = time.monotonic()
    caught_up = wait_for_catchup(orders, baseline_lsn, 300)
    mapper = json.loads(run(["python3", str(ROOT / "verify-reference-mapper.py")],
                            timeout=180))
    sink = json.loads(run(["python3", str(ROOT / "verify-reference-analytics.py")],
                          timeout=180))
    if mapper.get("status") != "PASS" or sink.get("status") != "PASS":
        raise RuntimeError("existing mapper/sink reconciliation did not pass")
    print(json.dumps({"status": "PASS", "project": PROJECT,
                      "outage_seconds": round(resumed_at - started_at, 2),
                      "synthetic_orders": len(orders),
                      "catchup_seconds": round(time.monotonic() - resumed_at, 2),
                      "wal_baseline": baseline, "wal_before_resume": before_resume,
                      "wal_after_catchup": source_sample(), "source_gate": caught_up,
                      "mapper": mapper, "sink": sink}, sort_keys=True), flush=True)


if __name__ == "__main__":
    raise SystemExit(main())
