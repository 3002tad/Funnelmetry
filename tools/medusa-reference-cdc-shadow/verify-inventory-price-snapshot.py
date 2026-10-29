#!/usr/bin/env python3
"""Check initial CDC snapshot coverage on a frozen inventory/price shadow clone.

Only counts, topic offsets and connector/slot state are printed. This is a
source-capture check, not a projection or analytical readiness certificate.
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
spec = importlib.util.spec_from_file_location("stage2_profile", ROOT / "install-inventory-price-shadow.py")
stage2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage2)
TABLES = tuple(stage2.TABLES)
PREFIX = stage2.PREFIX
BASE = ["docker", "compose", "-f", str(ROOT / "compose.yml")]
PROJECT = re.compile(r"(?:funnelmetry_cdc_inventory_price_shadow_|"
                     r"funnelmetry_cdc_combined_shadow_)[a-z0-9][a-z0-9_-]{0,32}\Z")


def run(command):
    result = subprocess.run(command, text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError("isolated snapshot inspection command failed")
    return result.stdout.strip()


def source_counts():
    pairs = ",".join(f"'{table}',(SELECT count(*) FROM public.{table})" for table in TABLES)
    query = f"SELECT json_build_object({pairs})::text;"
    return json.loads(run(BASE + ["exec", "-T", "postgres", "psql", "-X", "-U", "medusa",
                                  "-d", "medusa", "-At", "-c", query]))


def source_slot():
    query = ("SELECT COALESCE((SELECT wal_status FROM pg_replication_slots WHERE "
             f"slot_name='{stage2.SLOT}'),'missing');")
    return run(BASE + ["exec", "-T", "postgres", "psql", "-X", "-U", "medusa",
                       "-d", "medusa", "-At", "-c", query])


def connector_state():
    base = BASE + ["exec", "-T", "connect", "curl", "-fsS", "--max-time", "10"]
    status = json.loads(run(base + [f"http://127.0.0.1:8083/connectors/{stage2.CONNECTOR}/status"]))
    offsets = json.loads(run(base + [f"http://127.0.0.1:8083/connectors/{stage2.CONNECTOR}/offsets"]))
    healthy = status.get("connector", {}).get("state") == "RUNNING" and bool(status.get("tasks"))
    healthy = healthy and all(task.get("state") == "RUNNING" for task in status["tasks"])
    values = offsets.get("offsets", [])
    checkpoint = values[0].get("offset", {}) if len(values) == 1 else {}
    complete = bool(checkpoint.get("lsn")) and "snapshot" not in checkpoint
    return healthy, complete


def topic_ends():
    kafka = BASE + ["exec", "-T", "kafka"]
    available = set(run(kafka + ["/opt/kafka/bin/kafka-topics.sh", "--bootstrap-server",
                                 "kafka:9092", "--list"]).splitlines())
    ends = {}
    for table in TABLES:
        topic = f"{PREFIX}.public.{table}"
        if topic not in available:
            ends[table] = None
            continue
        output = run(kafka + ["/opt/kafka/bin/kafka-get-offsets.sh", "--bootstrap-server",
                              "kafka:9092", "--topic", topic])
        lines = [line for line in output.splitlines() if line.startswith(topic + ":0:")]
        if len(lines) != 1 or len(output.splitlines()) != 1:
            raise RuntimeError("unexpected inventory/price topic partition layout")
        ends[table] = int(lines[0].rsplit(":", 1)[1])
    return ends


def evaluate(counts, ends, running, complete, slot, running_services):
    matches = {table: (ends[table] == counts[table] if counts[table] else
                       ends[table] in (None, 0)) for table in TABLES}
    checks = {"isolated_services_only": set(running_services) == {"postgres", "kafka", "connect"},
              "slot_usable": slot in ("reserved", "extended"),
              "connector_running": running, "initial_snapshot_completed": complete,
              "snapshot_row_counts_match": all(matches.values())}
    return {"status": "PASS_CAPTURE_ONLY" if all(checks.values()) else "BLOCKED_BY_QUALITY",
            "checks": checks, "table_counts": {table: {"source": counts[table],
                                               "snapshot_topic_end": ends[table],
                                               "match": matches[table]} for table in TABLES}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeout-seconds", type=int, default=0)
    args = parser.parse_args()
    if not PROJECT.fullmatch(os.environ.get("COMPOSE_PROJECT_NAME", "")):
        parser.error("requires an isolated inventory/price shadow project")
    if not 0 <= args.timeout_seconds <= 600:
        parser.error("timeout must be 0..600 seconds")
    deadline = time.monotonic() + args.timeout_seconds
    while True:
        services = run(BASE + ["ps", "--services", "--status", "running"]).splitlines()
        running, complete = connector_state()
        result = evaluate(source_counts(), topic_ends(), running, complete,
                          source_slot(), services)
        if result["status"] == "PASS_CAPTURE_ONLY" or time.monotonic() >= deadline:
            print(json.dumps(result, sort_keys=True))
            return 0 if result["status"] == "PASS_CAPTURE_ONLY" else 1
        time.sleep(5)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired) as error:
        raise SystemExit(f"cdc-inventory-price-snapshot-verifier: {error}") from None
