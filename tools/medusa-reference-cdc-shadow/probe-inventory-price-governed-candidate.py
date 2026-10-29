#!/usr/bin/env python3
"""Exercise a clone-only CDC update, soft delete, restore and Kafka replay."""

import importlib.util
import json
import os
import re
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("candidate_check", ROOT / "verify-inventory-price-governed-candidate.py")
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)
snapshot = check.snapshot
COMPOSE = check.COMPOSE


def run(command, stdin=None):
    result = subprocess.run(command, input=stdin, text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError("isolated inventory/price candidate command failed")
    return result.stdout.strip()


def source_sql(statement):
    return run(snapshot.BASE + ["exec", "-T", "postgres", "psql", "-X", "-U", "medusa",
                                "-d", "medusa", "-At", "-v", "ON_ERROR_STOP=1"], statement)


def candidate_sql(statement):
    return run(COMPOSE + ["exec", "-T", "inventory-price-projection-db", "psql", "-X",
                          "-U", "inventory_price_projection", "-d", "inventory_price_projection",
                          "-At", "-v", "ON_ERROR_STOP=1"], statement)


def state():
    running, complete = snapshot.connector_state()
    return check.stage2.evaluate(check.stage2.source_rows(), check.candidate_rows(),
                                 snapshot.topic_ends(), check.candidate_offsets(), running,
                                 complete, snapshot.source_slot())


def catch_up(timeout=120):
    deadline = time.monotonic() + timeout
    while True:
        result = state()
        if result["status"] == "PASS_CONTEXT_ONLY":
            return result
        if time.monotonic() >= deadline:
            raise RuntimeError("candidate context did not reconcile")
        time.sleep(5)


def audit():
    epoch = os.environ["CDC_COVERAGE_EPOCH"]
    result = candidate_sql("SELECT json_build_object('count',count(*),'offsets',"
                           "(SELECT COALESCE(jsonb_object_agg(topic,next_offset),'{}'::jsonb) "
                           "FROM inventory_price_cdc_input_offsets "
                           f"WHERE coverage_epoch_id='{epoch}'))::text "
                           "FROM inventory_price_cdc_ingest_audit "
                           f"WHERE coverage_epoch_id='{epoch}';")
    return json.loads(result)


def group_caught_up(group, ends, timeout=120):
    deadline = time.monotonic() + timeout
    while True:
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
        if all(committed.get(f"{snapshot.PREFIX}.public.{table}", -1) >= (end or 0)
               for table, end in ends.items()):
            return
        if time.monotonic() >= deadline:
            raise RuntimeError("candidate consumer group did not replay all topics")
        time.sleep(5)


def main():
    epoch = os.environ.get("CDC_COVERAGE_EPOCH", "")
    if os.environ.get("COMPOSE_PROJECT_NAME") != "funnelmetry_cdc_inventory_price_shadow_stage2b" or \
            epoch != "inventory-price-shadow-20261029-b":
        raise RuntimeError("requires exact isolated stage2b clone and epoch")
    running = set(run(COMPOSE + ["ps", "--services", "--status", "running"]).splitlines())
    if "backend" in running or "inventory-price-projector" in running or \
            "inventory-price-governed-writer" not in running:
        raise RuntimeError("unexpected source backend or candidate writer state")
    catch_up()
    level = source_sql("SELECT id FROM inventory_level ORDER BY id LIMIT 1;")
    price_set = source_sql("SELECT id FROM price_set WHERE deleted_at IS NULL ORDER BY id LIMIT 1;")
    if not all(re.fullmatch(r"[A-Za-z0-9_-]+", value) for value in (level, price_set)):
        raise RuntimeError("unexpected clone identifiers")
    before = source_sql(f"SELECT incoming_quantity FROM inventory_level WHERE id='{level}';")
    if not re.fullmatch(r"[0-9]+", before):
        raise RuntimeError("unexpected inventory quantity")
    source_sql(f"UPDATE inventory_level SET incoming_quantity=incoming_quantity+1 "
               f"WHERE id='{level}';")
    try:
        catch_up()
        source_sql(f"UPDATE price_set SET deleted_at=now() WHERE id='{price_set}';")
        catch_up()
    finally:
        source_sql(f"UPDATE inventory_level SET incoming_quantity={before} WHERE id='{level}';"
                   f"UPDATE price_set SET deleted_at=NULL WHERE id='{price_set}';")
    catch_up()
    before_replay = audit()
    group = f"cdc-shadow-governed-inventory-price-{epoch}"
    run(COMPOSE + ["stop", "inventory-price-governed-writer"])
    try:
        run(COMPOSE + ["exec", "-T", "kafka", "/opt/kafka/bin/kafka-consumer-groups.sh",
                       "--bootstrap-server", "kafka:9092", "--group", group,
                       "--reset-offsets", "--to-earliest", "--all-topics", "--execute"])
    finally:
        run(COMPOSE + ["up", "-d", "inventory-price-governed-writer"])
    group_caught_up(group, snapshot.topic_ends())
    catch_up()
    after_replay = audit()
    status = "PASS_REPLAY" if before_replay == after_replay else "BLOCKED_BY_QUALITY"
    print(json.dumps({"status": status, "audit_before": before_replay["count"],
                      "audit_after": after_replay["count"],
                      "offsets_unchanged": before_replay["offsets"] == after_replay["offsets"]},
                     sort_keys=True))
    if status != "PASS_REPLAY":
        raise RuntimeError("candidate replay changed durable effects")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired) as error:
        raise SystemExit(f"inventory-price-governed-candidate-probe: {error}") from None
