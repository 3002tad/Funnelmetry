#!/usr/bin/env python3
"""Interrupt and resume epoch-4 initial snapshot on the isolated CDC-10 clone."""

import argparse
import json
import os
import select
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PROJECT = "funnelmetry_cdc_shadow_cdc10"
BASE = ["docker", "compose", "-f", str(ROOT / "compose.yml")]
PREFIX = "cdc_shadow_medusa_epoch4"
SLOT = "funnelmetry_cdc10_epoch4"
CONNECTOR = "cdc-shadow-medusa-rebaseline-cdc10-epoch4"
TABLES = ("order", "order_cart", "cart")


def run(argv, stdin=None, required=True, timeout=120):
    result = subprocess.run(argv, input=stdin, capture_output=True, text=True,
                            timeout=timeout, check=False)
    if required and result.returncode:
        raise RuntimeError(f"snapshot drill command failed: {argv[0]} (exit {result.returncode})")
    return result.stdout.strip()


def sql(statement):
    return run(BASE + ["exec", "-T", "postgres", "psql", "-X", "-U", "medusa",
                       "-d", "medusa", "-At", "-v", "ON_ERROR_STOP=1"], statement)


def api(path="", method="GET", payload=None, required=True):
    argv = BASE + ["exec", "-T", "connect", "curl", "-fsS", "--max-time", "10",
                   "-H", "Content-Type: application/json", "-X", method]
    if payload is not None:
        argv += ["--data-binary", "@-"]
    result = run(argv + ["http://127.0.0.1:8083/connectors" + path],
                 json.dumps(payload) if payload is not None else None, required)
    return json.loads(result) if result else None


def end_offset(table):
    topic = f"{PREFIX}.public.{table}"
    output = run(BASE + ["exec", "-T", "kafka", "/opt/kafka/bin/kafka-get-offsets.sh",
                         "--bootstrap-server", "kafka:9092", "--topic", topic],
                 required=False)
    rows = [line for line in output.splitlines() if line.startswith(topic + ":0:")]
    return int(rows[0].rsplit(":", 1)[1]) if len(rows) == 1 else 0


def connector_config():
    config = api("/cdc-shadow-medusa-rebaseline-cdc10-epoch3/config")
    if config.get("snapshot.mode") != "initial" or config.get("slot.name") != "funnelmetry_cdc10_epoch3":
        raise RuntimeError("epoch-3 connector configuration is not the owned initial snapshot")
    config.pop("name", None)
    config["topic.prefix"] = PREFIX
    config["slot.name"] = SLOT
    config["snapshot.fetch.size"] = "1"
    return config


def topic_snapshot(table):
    topic = f"{PREFIX}.public.{table}"
    end = end_offset(table)
    if end < 1 or end > 300000:
        raise RuntimeError("snapshot topic missing or exceeds bounded drill cap")
    process = subprocess.Popen(BASE + ["exec", "-T", "kafka", "/opt/kafka/bin/kafka-console-consumer.sh",
                      "--bootstrap-server", "kafka:9092", "--topic", topic,
                      "--from-beginning", "--max-messages", str(end),
                      "--timeout-ms", "30000"], stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, text=True)
    records = 0
    snapshot_records = 0
    ids = set()
    last_marker = False
    for line in process.stdout:
        records += 1
        row = json.loads(line)
        if row and row.get("op") == "r":
            snapshot_records += 1
            key = row.get("after", {}).get("id")
            if not isinstance(key, str):
                raise RuntimeError("snapshot row lacks primary key")
            ids.add(key)
            last_marker |= row.get("source", {}).get("snapshot") == "last"
    if process.wait(timeout=180) or records != end:
        raise RuntimeError("snapshot topic was not consumed through end offset")
    return {"topic_offset": end, "snapshot_records": snapshot_records,
            "unique_ids": len(ids), "duplicate_rows": snapshot_records - len(ids),
            "last_marker": last_marker}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inspect-existing", action="store_true")
    args = parser.parse_args()
    if os.environ.get("COMPOSE_PROJECT_NAME") != PROJECT:
        raise RuntimeError("only the isolated CDC-10 clone may be snapshot-interrupted")
    if sql("SHOW max_replication_slots;") != "4":
        raise RuntimeError("four-slot isolated clone overlay is required")
    before = json.loads(sql("""SELECT json_build_object('old',
      (SELECT wal_status FROM pg_replication_slots WHERE slot_name='funnelmetry_cdc_shadow'),
      'epoch2',(SELECT wal_status FROM pg_replication_slots WHERE slot_name='funnelmetry_cdc10_epoch2'),
      'epoch3',(SELECT wal_status FROM pg_replication_slots WHERE slot_name='funnelmetry_cdc10_epoch3'),
      'epoch4',(SELECT wal_status FROM pg_replication_slots WHERE slot_name='funnelmetry_cdc10_epoch4'),
      'orders',(SELECT count(*) FROM public."order"),
      'links',(SELECT count(*) FROM public.order_cart),
      'carts',(SELECT count(*) FROM public.cart))::text;"""))
    expected_epoch4 = "reserved" if args.inspect_existing else None
    if before["old"] != "lost" or before["epoch2"] != "lost" or before["epoch3"] != "reserved" or before["epoch4"] != expected_epoch4:
        raise RuntimeError("unexpected slot lineage before epoch-4 snapshot")
    if before["carts"] < 120000:
        raise RuntimeError("partial-snapshot drill requires the clone-only cart fixture")
    if args.inspect_existing:
        return inspect_existing(before)
    run(BASE + ["start", "connect"])
    deadline = time.monotonic() + 60
    while True:
        try:
            names = api()
            break
        except (RuntimeError, ValueError):
            if time.monotonic() > deadline:
                raise
            time.sleep(1)
    if CONNECTOR in names:
        raise RuntimeError("epoch-4 connector already exists")
    api("/cdc-shadow-medusa-rebaseline-cdc10-epoch3/stop", method="PUT")
    config = connector_config()
    topic = f"{PREFIX}.public.cart"
    run(BASE + ["exec", "-T", "kafka", "/opt/kafka/bin/kafka-topics.sh",
                "--bootstrap-server", "kafka:9092", "--create", "--topic", topic,
                "--partitions", "1", "--replication-factor", "1"])
    observer = subprocess.Popen(BASE + ["exec", "-T", "kafka",
        "/opt/kafka/bin/kafka-console-consumer.sh", "--bootstrap-server", "kafka:9092",
        "--topic", topic, "--partition", "0", "--offset", "0",
        "--max-messages", "1", "--timeout-ms", "120000"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    api(payload={"name": CONNECTOR, "config": config}, method="POST")
    interrupted = None
    deadline = time.monotonic() + 240
    expected_total = before["orders"] + before["links"] + before["carts"]
    try:
        while time.monotonic() < deadline:
            ready, _, _ = select.select([observer.stdout], [], [], 2)
            if ready and observer.stdout.readline():
                offsets = {table: end_offset(table) for table in TABLES}
                total = sum(offsets.values())
                if not 0 < total < expected_total:
                    raise RuntimeError("snapshot completed before partial interruption")
                # Immediate SIGKILL models an unclean Connect worker failure.
                run(["docker", "kill", "--signal=KILL", PROJECT + "-connect-1"])
                interrupted = {"offsets": offsets, "total": total,
                               "source_snapshot_rows": expected_total}
                break
            if observer.poll() is not None:
                raise RuntimeError("snapshot observer exited before the first row")
        if interrupted is None:
            raise RuntimeError("no partial snapshot rows observed before timeout")
    except BaseException:
        # If the connector was not killed, stop it to avoid an unverified stream.
        run(BASE + ["stop", "connect"], required=False)
        raise
    finally:
        if observer.poll() is None:
            observer.terminate()
        observer.wait(timeout=10)
    run(BASE + ["start", "connect"])
    deadline = time.monotonic() + 300
    while time.monotonic() < deadline:
        try:
            status = api("/" + CONNECTOR + "/status")
            running = status.get("connector", {}).get("state") == "RUNNING" and all(
                task.get("state") == "RUNNING" for task in status.get("tasks", []))
            offsets = {table: end_offset(table) for table in TABLES}
            if running and sum(offsets.values()) >= expected_total:
                break
        except (RuntimeError, ValueError):
            pass
        time.sleep(2)
    else:
        raise RuntimeError("epoch-4 snapshot did not resume to expected row count")
    return inspect_existing(before, interrupted)


def inspect_existing(before, interrupted=None):
    status = api("/" + CONNECTOR + "/status")
    if status.get("connector", {}).get("state") != "RUNNING" or not status.get("tasks") or any(
            task.get("state") != "RUNNING" for task in status["tasks"]):
        raise RuntimeError("epoch-4 connector is not RUNNING after restart")
    actual = {table: topic_snapshot(table) for table in TABLES}
    if any(actual[table]["unique_ids"] != before[{"order": "orders",
                                                   "order_cart": "links",
                                                   "cart": "carts"}[table]] for table in TABLES):
        raise RuntimeError("resumed snapshot has incomplete/extra unique source rows")
    if not any(value["last_marker"] for value in actual.values()):
        raise RuntimeError("resumed snapshot has no global completion marker")
    after = json.loads(sql("""SELECT json_build_object('epoch2',
      (SELECT wal_status FROM pg_replication_slots WHERE slot_name='funnelmetry_cdc10_epoch2'),
      'epoch4',(SELECT wal_status FROM pg_replication_slots WHERE slot_name='funnelmetry_cdc10_epoch4'))::text;"""))
    if after != {"epoch2": "lost", "epoch4": "reserved"}:
        raise RuntimeError("resumed snapshot slot lineage is unsafe")
    result = {"status": "PASS_SNAPSHOT_RESTART", "interrupted": interrupted,
              "source_counts": {key: before[key] for key in ("orders", "links", "carts")},
              "topic_counts": actual, "slots": after,
              "historical_gap_status": "INCOMPLETE", "business_on_from_snapshot": 0}
    protected = ROOT / "private" / "cdc10-epoch4-snapshot-interrupt.json"
    fd = os.open(protected, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        json.dump(result, stream, sort_keys=True)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
