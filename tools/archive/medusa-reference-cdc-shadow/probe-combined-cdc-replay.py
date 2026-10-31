#!/usr/bin/env python3
"""Replay both governed CDC consumer groups on the exact isolated combined clone."""

import hashlib
import importlib.util
import json
import os
import re
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "transition", ROOT / "probe-combined-cdc-transition.py")
transition = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transition)
catalog = transition.catalog
inventory = transition.inventory
BASE = catalog.old.BASE
COMPOSE = BASE + ["-f", str(ROOT / "compose.catalog-projection.yml"),
                  "-f", str(ROOT / "compose.inventory-price-projection.yml"),
                  "-f", str(ROOT / "compose.catalog-governed-candidate.yml"),
                  "-f", str(ROOT / "compose.inventory-price-governed-candidate.yml")]


def run(args, *, stdin=None):
    completed = subprocess.run(args, input=stdin, text=True, capture_output=True,
                               check=False)
    if completed.returncode:
        raise RuntimeError("combined replay command failed; inspect protected clone logs")
    return completed.stdout.strip()


def db_count(service, user, database, table):
    return int(run(COMPOSE + ["exec", "-T", service, "psql", "-X", "-U", user,
                              "-d", database, "-At", "-c", f"SELECT count(*) FROM {table};"]))


def digest(rows):
    canonical = {table: sorted((json.dumps(row, sort_keys=True, separators=(",", ":"))
                                for row in values)) for table, values in rows.items()}
    return hashlib.sha256(json.dumps(canonical, sort_keys=True).encode()).hexdigest()


def state():
    catalog_result, stage2_result = transition.reconcile()
    return {
        "catalog_audit": catalog_result["audit_count"],
        "catalog_digest": catalog_result["projection_digest"],
        "catalog_offsets": catalog_result["next_input_offsets"],
        "inventory_audit": db_count("inventory-price-projection-db",
                                    "inventory_price_projection", "inventory_price_projection",
                                    "inventory_price_cdc_ingest_audit"),
        "inventory_digest": digest(inventory.candidate_rows()),
        "inventory_offsets": inventory.candidate_offsets(),
        "stage2_status": stage2_result["status"],
    }


def group_offsets(group):
    output = run(COMPOSE + ["exec", "-T", "kafka",
                            "/opt/kafka/bin/kafka-consumer-groups.sh",
                            "--bootstrap-server", "kafka:9092", "--group", group,
                            "--describe"])
    committed = {}
    for line in output.splitlines():
        columns = line.split()
        if len(columns) >= 5 and columns[0] == group and columns[2] == "0" and \
                columns[3].isdigit():
            committed[columns[1]] = int(columns[3])
    return committed


def await_group(group, ends, timeout=180):
    deadline = time.monotonic() + timeout
    while True:
        committed = group_offsets(group)
        if all(committed.get(topic, -1) >= end for topic, end in ends.items()):
            return
        if time.monotonic() >= deadline:
            raise RuntimeError("combined CDC group did not reach all topic ends")
        time.sleep(5)


def main():
    catalog_epoch = os.environ.get("CATALOG_CDC_COVERAGE_EPOCH", "")
    inventory_epoch = os.environ.get("CDC_COVERAGE_EPOCH", "")
    if (os.environ.get("COMPOSE_PROJECT_NAME") != transition.PROJECT or
            not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", catalog_epoch) or
            not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", inventory_epoch)):
        raise RuntimeError("requires exact combined isolated clone and epochs")
    transition.combined.verify_common_clone_source()
    before = state()
    catalog_ends = catalog.old.topic_ends()
    inventory_ends = inventory.snapshot.topic_ends()
    catalog_diff = [topic for topic, end in catalog_ends.items()
                    if before["catalog_offsets"].get(topic) != end]
    inventory_diff = [table for table, end in inventory_ends.items()
                      if end is not None and not (
                          end == 0 and before["inventory_offsets"].get(
                              f"{inventory.snapshot.PREFIX}.public.{table}") in (None, 0))
                      and before["inventory_offsets"].get(
                          f"{inventory.snapshot.PREFIX}.public.{table}") != end]
    if catalog_diff or inventory_diff:
        raise RuntimeError("both CDC projections must be caught up before replay: "
                           + json.dumps({"catalog_topics": catalog_diff,
                                         "inventory_tables": inventory_diff}, sort_keys=True))
    groups = {
        "catalog-governed-writer": (
            f"cdc-shadow-governed-catalog-{catalog_epoch}", catalog_ends),
        "inventory-price-governed-writer": (
            f"cdc-shadow-governed-inventory-price-{inventory_epoch}",
            {f"{inventory.snapshot.PREFIX}.public.{table}": end
             for table, end in inventory_ends.items() if end}),
    }
    services = list(groups)
    run(COMPOSE + ["stop"] + services)
    try:
        for group, _ in groups.values():
            run(COMPOSE + ["exec", "-T", "kafka",
                           "/opt/kafka/bin/kafka-consumer-groups.sh",
                           "--bootstrap-server", "kafka:9092", "--group", group,
                           "--reset-offsets", "--to-earliest", "--all-topics", "--execute"])
    finally:
        run(COMPOSE + ["up", "-d"] + services)
    for group, ends in groups.values():
        await_group(group, ends)
    after = state()
    same = before == after
    print(json.dumps({"status": "PASS_REPLAY" if same else "BLOCKED_BY_QUALITY",
                      "catalog_audit_before": before["catalog_audit"],
                      "catalog_audit_after": after["catalog_audit"],
                      "inventory_audit_before": before["inventory_audit"],
                      "inventory_audit_after": after["inventory_audit"],
                      "catalog_offsets_unchanged": before["catalog_offsets"] ==
                                                   after["catalog_offsets"],
                      "inventory_offsets_unchanged": before["inventory_offsets"] ==
                                                     after["inventory_offsets"],
                      "state_digests_unchanged": before["catalog_digest"] ==
                                                 after["catalog_digest"] and
                                                 before["inventory_digest"] ==
                                                 after["inventory_digest"]}, sort_keys=True))
    return 0 if same else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, OSError) as error:
        raise SystemExit(f"combined-cdc-replay: {error}") from None
