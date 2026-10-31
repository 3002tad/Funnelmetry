#!/usr/bin/env python3
"""Exercise one update and replay on the isolated Pipeline catalog candidate."""

import importlib.util
import json
import os
import re
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("candidate_check", ROOT / "verify-catalog-governed-candidate.py")
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)
old = check.old
COMPOSE = old.BASE + ["-f", str(ROOT / "compose.catalog-projection.yml"),
                      "-f", str(ROOT / "compose.catalog-governed-candidate.yml")]
GROUP = "cdc-shadow-governed-catalog-20261029-a"
SUFFIX = " [governed-cdc-probe]"


def run(command, stdin=None):
    result = subprocess.run(command, input=stdin, text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError("isolated candidate probe command failed")
    return result.stdout.strip()


def source_sql(statement):
    return run(old.BASE + ["exec", "-T", "postgres", "psql", "-X", "-U", "medusa",
                           "-d", "medusa", "-At", "-v", "ON_ERROR_STOP=1"], statement)


def candidate_sql(statement):
    return run(COMPOSE + ["exec", "-T", "catalog-projection-db", "psql", "-X",
                          "-U", "catalog_projection", "-d", "catalog_projection", "-At",
                          "-v", "ON_ERROR_STOP=1"], statement)


def state():
    return old.evaluate(old.source(), check.projection(), old.topic_ends(),
                        old.connector_running())


def catch_up(timeout=120):
    deadline = time.monotonic() + timeout
    while True:
        result = state()
        if result["status"] == "PASS":
            return result
        if time.monotonic() >= deadline:
            raise RuntimeError("candidate writer did not reconcile")
        time.sleep(5)


def main():
    if os.environ.get("COMPOSE_PROJECT_NAME") != "funnelmetry_cdc_catalog_shadow_catalog1" or \
            os.environ.get("CATALOG_CDC_COVERAGE_EPOCH") != "catalog-shadow-20261029-a":
        raise RuntimeError("candidate probe requires the reviewed isolated clone and epoch")
    running = set(run(COMPOSE + ["ps", "--services", "--status", "running"]).splitlines())
    if "backend" in running or "catalog-projector" in running or \
            "catalog-governed-writer" not in running:
        raise RuntimeError("unexpected source backend or candidate writer state")
    catch_up()
    product = source_sql("SELECT id FROM product WHERE deleted_at IS NULL ORDER BY id LIMIT 1;")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", product):
        raise RuntimeError("unexpected clone product identifier")
    source_sql(f"UPDATE product SET title=title || '{SUFFIX}',updated_at=now() "
               f"WHERE id='{product}';")
    try:
        changed = catch_up()
        print(json.dumps({"phase":"changed","status":changed["status"],
                          "audit_count":changed["audit_count"]},sort_keys=True))
    finally:
        source_sql(f"UPDATE product SET title=left(title,length(title)-{len(SUFFIX)}),"
                   f"updated_at=now() WHERE id='{product}' AND title LIKE '%{SUFFIX}';")
    restored = catch_up()
    before_count = restored["audit_count"]
    before_offsets = restored["next_input_offsets"]
    run(COMPOSE + ["stop", "catalog-governed-writer"])
    try:
        run(COMPOSE + ["exec", "-T", "kafka", "/opt/kafka/bin/kafka-consumer-groups.sh",
                       "--bootstrap-server", "kafka:9092", "--group", GROUP,
                       "--reset-offsets", "--to-earliest", "--all-topics", "--execute"])
    finally:
        run(COMPOSE + ["up", "-d", "catalog-governed-writer"])
    # Verify Kafka group progress, not only the idempotent SQL projection.
    deadline = time.monotonic() + 120
    ends = old.topic_ends()
    while True:
        output = run(COMPOSE + ["exec", "-T", "kafka",
                                "/opt/kafka/bin/kafka-consumer-groups.sh",
                                "--bootstrap-server", "kafka:9092", "--group", GROUP, "--describe"])
        committed = {}
        for line in output.splitlines():
            columns = line.split()
            if len(columns) >= 5 and columns[0] == GROUP and columns[2] == "0" and \
                    columns[3].isdigit():
                committed[columns[1]] = int(columns[3])
        if all(committed.get(topic, -1) >= end for topic, end in ends.items()):
            break
        if time.monotonic() >= deadline:
            raise RuntimeError("consumer group did not replay every catalog topic")
        time.sleep(5)
    replayed = catch_up()
    same = (replayed["audit_count"] == before_count and
            replayed["next_input_offsets"] == before_offsets)
    print(json.dumps({"phase":"restored_and_replayed","status":
                      "PASS" if same else "BLOCKED_BY_QUALITY",
                      "audit_before":before_count,"audit_after":replayed["audit_count"],
                      "offsets_unchanged":replayed["next_input_offsets"] == before_offsets},
                     sort_keys=True))
    if not same:
        raise RuntimeError("candidate replay changed durable effects")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired) as error:
        raise SystemExit(f"catalog-governed-candidate-probe: {error}") from None
