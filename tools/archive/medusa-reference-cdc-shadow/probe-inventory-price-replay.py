#!/usr/bin/env python3
"""Reset only the isolated stage-2 consumer group and prove replay idempotency."""

import importlib.util
import json
import os
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("stage2_projection_check", ROOT / "verify-inventory-price-projection.py")
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)
COMPOSE = check.PROJECTION
GROUP = f"cdc-shadow-inventory-price-projector-{os.environ.get('CDC_COVERAGE_EPOCH', '')}"


def run(command):
    result = subprocess.run(command, text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError("isolated replay command failed; inspect protected logs")
    return result.stdout.strip()


def audit_count():
    statement = "SELECT count(*) FROM context_cdc_audit;"
    output = run(COMPOSE + ["exec", "-T", "inventory-price-projection-db", "psql", "-X",
                            "-U", "inventory_price_projection", "-d", "inventory_price_projection",
                            "-At", "-c", statement])
    return int(output)


def reconciled(timeout=120):
    deadline = time.monotonic() + timeout
    while True:
        running, complete = check.snapshot.connector_state()
        result = check.evaluate(check.source_rows(), check.projection_rows(),
                                check.snapshot.topic_ends(), check.projection_offsets(),
                                running, complete, check.snapshot.source_slot())
        if result["status"] == "PASS_CONTEXT_ONLY":
            return result
        if time.monotonic() >= deadline:
            raise RuntimeError("projection did not reconcile after replay")
        time.sleep(5)


def wait_replayed(ends, timeout=120):
    deadline = time.monotonic() + timeout
    while True:
        output = run(COMPOSE + ["exec", "-T", "kafka",
                                "/opt/kafka/bin/kafka-consumer-groups.sh", "--bootstrap-server",
                                "kafka:9092", "--group", GROUP, "--describe"])
        committed = {}
        for line in output.splitlines():
            columns = line.split()
            if len(columns) >= 5 and columns[0] == GROUP and columns[2] == "0" and \
                    columns[3].isdigit():
                committed[columns[1]] = int(columns[3])
        if all(committed.get(f"{check.snapshot.PREFIX}.public.{table}", -1) >= end
               for table, end in ends.items() if end):
            return
        if time.monotonic() >= deadline:
            raise RuntimeError("consumer group did not replay all nonempty topics")
        time.sleep(5)


def main():
    if not check.snapshot.PROJECT.fullmatch(os.environ.get("COMPOSE_PROJECT_NAME", "")) or \
            os.environ.get("CDC_COVERAGE_EPOCH") != "inventory-price-shadow-20261029-b":
        raise RuntimeError("replay requires the isolated stage-2 project and epoch")
    baseline = reconciled()
    before_audit = audit_count()
    before_offsets = check.projection_offsets()
    run(COMPOSE + ["stop", "inventory-price-projector"])
    try:
        kafka = COMPOSE + ["exec", "-T", "kafka", "/opt/kafka/bin/kafka-consumer-groups.sh",
                           "--bootstrap-server", "kafka:9092", "--group", GROUP,
                           "--reset-offsets", "--all-topics", "--to-earliest", "--execute"]
        run(kafka)
    finally:
        run(COMPOSE + ["up", "-d", "inventory-price-projector"])
    wait_replayed(check.snapshot.topic_ends())
    after = reconciled()
    after_audit = audit_count()
    after_offsets = check.projection_offsets()
    unchanged = (before_audit == after_audit and before_offsets == after_offsets and
                 baseline["status"] == after["status"] == "PASS_CONTEXT_ONLY")
    print(json.dumps({"status": "PASS_REPLAY" if unchanged else "BLOCKED_BY_QUALITY",
                      "audit_before": before_audit, "audit_after": after_audit,
                      "offsets_unchanged": before_offsets == after_offsets}, sort_keys=True))
    if not unchanged:
        raise RuntimeError("replay changed source-row projection or audit effects")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired) as error:
        raise SystemExit(f"cdc-inventory-price-replay-probe: {error}") from None
