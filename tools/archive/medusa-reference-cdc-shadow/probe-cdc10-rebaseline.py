#!/usr/bin/env python3
"""Shadow-only CDC-10 recovery rehearsal on the retained lost-slot clone.

The command never promotes a live contract. It creates a new Debezium lineage,
checks an initial snapshot against a frozen source, then checks post-snapshot
changes without turning snapshot rows into ON occurrences. No raw row is logged.
"""

import argparse
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PROJECT = "funnelmetry_cdc_shadow_cdc10"
BASE = ["docker", "compose", "-f", str(ROOT / "compose.yml")]
CONNECTOR = "cdc-shadow-medusa-rebaseline-cdc10-epoch2"
SLOT = "funnelmetry_cdc10_epoch2"
PREFIX = "cdc_shadow_medusa_epoch2"
TABLES = ("order", "order_cart", "cart")
ORDER_ID = re.compile(r"order_[A-Za-z0-9]+\Z")
STATE = ROOT / "private" / "cdc10-rebaseline-epoch2.json"


def run(command, *, input_text=None, timeout=90):
    result = subprocess.run(command, input=input_text, text=True,
                            capture_output=True, timeout=timeout, check=False)
    if result.returncode:
        # Docker/Connect diagnostics may include credentials or source rows.
        raise RuntimeError(f"shadow command failed: {command[0]} {command[1]}")
    return result.stdout.strip()


def sql(statement):
    output = run(BASE + ["exec", "-T", "postgres", "psql", "-X", "-U", "medusa",
                         "-d", "medusa", "-At", "-v", "ON_ERROR_STOP=1"],
                 input_text=statement)
    lines = [line for line in output.splitlines() if line.startswith("{")]
    if len(lines) != 1:
        raise RuntimeError("unexpected source query shape")
    return json.loads(lines[0])


def source_state():
    result = sql('''BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT json_build_object(
  'orders', (SELECT COALESCE(json_agg(json_build_object('id',id,'deleted_at',deleted_at IS NOT NULL)
    ORDER BY id),'[]'::json) FROM public."order"),
  'links', (SELECT COALESCE(json_agg(json_build_object('id',id,'order_id',order_id,
    'cart_id',cart_id) ORDER BY id),'[]'::json) FROM public.order_cart),
  'carts', (SELECT COALESCE(json_agg(json_build_object('id',id,'completed_at',completed_at IS NOT NULL)
    ORDER BY id),'[]'::json) FROM public.cart))::text;
COMMIT;''')
    return result


def connector_api(path="", payload=None, method="GET"):
    command = BASE + ["exec", "-T", "connect", "curl", "-fsS", "--max-time", "15",
                      "-H", "Content-Type: application/json", "-X", method]
    if payload is not None:
        command += ["--data-binary", "@-"]
    output = run(command + ["http://127.0.0.1:8083/connectors" + path],
                 input_text=json.dumps(payload) if payload is not None else None)
    return json.loads(output) if output else None


def installer_module():
    spec = importlib.util.spec_from_file_location("shadow_installer", ROOT / "install-reference.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def expected_config():
    installer = installer_module()
    password = installer.secret_url({"source_db_url_ref": "FUNNELMETRY_CDC_SHADOW_DATABASE_URL"})
    config = installer.connector_config(password)
    config.update({"topic.prefix": PREFIX, "slot.name": SLOT, "snapshot.mode": "initial"})
    config["column.include.list"] = ",".join((
        "public.order.id", "public.order.deleted_at",
        "public.order_cart.id", "public.order_cart.order_id", "public.order_cart.cart_id",
        "public.cart.id", "public.cart.completed_at"))
    return config


def slot_state():
    return sql(f"""SELECT json_build_object('old', (SELECT wal_status FROM pg_replication_slots
      WHERE slot_name='funnelmetry_cdc_shadow'), 'new', (SELECT wal_status
      FROM pg_replication_slots WHERE slot_name='{SLOT}'), 'current_lsn',
      pg_current_wal_lsn()::text)::text;""")


def write_state(value):
    if STATE.exists():
        raise RuntimeError("epoch ownership record already exists")
    fd = os.open(STATE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, sort_keys=True)
            stream.write("\n")
    except BaseException:
        STATE.unlink(missing_ok=True)
        raise


def read_state():
    if not STATE.exists() or STATE.stat().st_mode & 0o077:
        raise RuntimeError("missing or non-private epoch ownership record")
    value = json.loads(STATE.read_text(encoding="utf-8"))
    if value.get("connector") != CONNECTOR or value.get("slot") != SLOT or value.get("prefix") != PREFIX:
        raise RuntimeError("foreign epoch ownership record")
    return value


def setup():
    # Keep writes frozen while the new connector takes its baseline.
    active = set(run(BASE + ["ps", "--status", "running", "--services"]).splitlines())
    if active != {"connect", "kafka", "postgres"}:
        raise RuntimeError("only postgres, kafka and connect may run during baseline")
    slot = slot_state()
    if slot["old"] != "lost" or slot["new"] is not None:
        raise RuntimeError("expected lost old slot and no recovery slot")
    names = connector_api()
    if CONNECTOR in names:
        raise RuntimeError("recovery connector exists without an ownership record")
    if "medusa-cdc-shadow" not in names:
        raise RuntimeError("old connector missing; cannot audit prior epoch")
    old_config = connector_api("/medusa-cdc-shadow/config")
    original = installer_module().connector_config(expected_config()["database.password"])
    if {key: value for key, value in old_config.items() if key != "name"} != original:
        raise RuntimeError("old connector config is not the owned no_data lineage")
    connector_api("/medusa-cdc-shadow/stop", method="PUT")
    record = {"contract_candidate": "reference.medusa.order_recorded_state.v2",
              "coverage_epoch_id": "cdc10-epoch2", "coverage": "CURRENT_STATE_FROM_REBASELINE",
              "previous_epoch": "cdc10-epoch1", "previous_epoch_status": "INCOMPLETE",
              "gap": "WAL after last verified old epoch through new snapshot is incomplete",
              "old_slot": "funnelmetry_cdc_shadow", "connector": CONNECTOR,
              "slot": SLOT, "prefix": PREFIX, "snapshot_mode": "initial",
              "source_lsn_before_snapshot": slot["current_lsn"], "status": "BASELINING"}
    write_state(record)
    try:
        connector_api(payload={"name": CONNECTOR, "config": expected_config()}, method="POST")
    except BaseException:
        # Retain record: Connect may have accepted the request before a timeout.
        raise
    return {"status": "BASELINING", "coverage_epoch_id": "cdc10-epoch2",
            "old_slot_status": slot["old"], "new_connector": CONNECTOR}


def constrain_snapshot_columns():
    """Repair only the pre-data test connector created by this probe."""
    record = read_state()
    if record.get("status") != "BASELINING":
        raise RuntimeError("column filter repair requires an incomplete baseline")
    current = connector_api("/" + CONNECTOR + "/config")
    expected = expected_config()
    previous = dict(expected)
    previous.pop("column.include.list")
    if {key: value for key, value in current.items() if key != "name"} != previous:
        raise RuntimeError("connector config is not the exact pre-filter test revision")
    topics = run(BASE + ["exec", "-T", "kafka", "/opt/kafka/bin/kafka-topics.sh",
                         "--bootstrap-server", "kafka:9092", "--list"])
    if any(line.startswith(PREFIX + ".") for line in topics.splitlines()):
        raise RuntimeError("recovery topic already contains data; do not repair in place")
    connector_api("/" + CONNECTOR + "/config", payload=expected, method="PUT")
    return {"status": "BASELINING", "column_filter": "EXACT_SEVEN_COLUMNS"}


def topic_messages(topic, *, may_be_absent=False):
    output = run(BASE + ["exec", "-T", "kafka", "/opt/kafka/bin/kafka-get-offsets.sh",
                         "--bootstrap-server", "kafka:9092", "--topic", topic])
    lines = [line for line in output.splitlines() if line.startswith(topic + ":0:")]
    if not lines and may_be_absent:
        return []
    if len(lines) != 1:
        raise RuntimeError("missing or partitioned recovery topic")
    count = int(lines[0].rsplit(":", 1)[1])
    if count > 200000:
        raise RuntimeError("recovery topic exceeds bounded probe cap")
    if count == 0:
        return []
    raw = run(BASE + ["exec", "-T", "kafka", "/opt/kafka/bin/kafka-console-consumer.sh",
                      "--bootstrap-server", "kafka:9092", "--topic", topic,
                      "--from-beginning", "--max-messages", str(count),
                      "--timeout-ms", "30000"], timeout=90)
    values = [json.loads(line) for line in raw.splitlines()]
    if len(values) != count:
        raise RuntimeError("recovery topic was not read through its end offset")
    return values


def read_topics(*, include_transaction=True):
    data = {table: topic_messages(f"{PREFIX}.public.{table}") for table in TABLES}
    data["transaction"] = (topic_messages(f"{PREFIX}.transaction")
                           if include_transaction else [])
    return data


def diagnose():
    data = read_topics(include_transaction=False)
    summary = {}
    for table in TABLES:
        counts = {}
        for message in data[table]:
            key = (str(message.get("op")), str((message.get("source") or {}).get("snapshot"))) if message else ("null", "null")
            counts["/".join(key)] = counts.get("/".join(key), 0) + 1
        summary[table] = counts
    return {"status": "DIAGNOSTIC", "operation_snapshot_counts": summary}


def projections(data):
    result = {"orders": {}, "links": {}, "carts": {}}
    key = {"order": "orders", "order_cart": "links", "cart": "carts"}
    for table in TABLES:
        for message in data[table]:
            if message is None:
                continue
            source = message.get("source") or {}
            if source.get("name") != PREFIX or source.get("db") != "medusa" or source.get("schema") != "public" or source.get("table") != table:
                raise RuntimeError("foreign source row in recovery topic")
            op = message.get("op")
            if op not in ("r", "c", "u", "d"):
                raise RuntimeError("unsupported recovery operation")
            if op == "r" and source.get("snapshot") not in (
                    True, "true", "first", "first_in_data_collection",
                    "last_in_data_collection", "last"):
                raise RuntimeError("snapshot row has invalid marker")
            if op != "r" and source.get("snapshot") not in (False, "false", None):
                raise RuntimeError("stream row has invalid snapshot marker")
            row = message.get("before") if op == "d" else message.get("after")
            if not isinstance(row, dict) or not isinstance(row.get("id"), str):
                raise RuntimeError("recovery row lacks primary key")
            fields = {"order": ("id", "deleted_at"),
                      "order_cart": ("id", "order_id", "cart_id"),
                      "cart": ("id", "completed_at")}[table]
            if op != "d" and set(row) != set(fields):
                raise RuntimeError("recovery row columns differ from exact allowlist")
            projected = {field: row.get(field) for field in fields}
            if table == "order":
                projected["deleted_at"] = row.get("deleted_at") is not None
            elif table == "cart":
                projected["completed_at"] = row.get("completed_at") is not None
            if op == "d":
                result[key[table]].pop(row["id"], None)
            else:
                result[key[table]][row["id"]] = projected
    return result


def active_pairs(state):
    pairs = {}
    for link in state["links"].values():
        order = state["orders"].get(link["order_id"])
        cart = state["carts"].get(link["cart_id"])
        if order and not order["deleted_at"] and cart and cart["completed_at"]:
            if link["order_id"] in pairs and pairs[link["order_id"]] != link["cart_id"]:
                raise RuntimeError("multiple eligible carts for one order")
            pairs[link["order_id"]] = link["cart_id"]
    return pairs


def digest_pairs(pairs):
    canonical = json.dumps(pairs, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def validate_transaction_ends(data):
    actual = {}
    for table in TABLES:
        for message in data[table]:
            if not message or message.get("op") == "r":
                continue
            txid = (message.get("source") or {}).get("txId")
            if not isinstance(txid, int) or txid < 0:
                raise RuntimeError("stream row has invalid transaction ID")
            actual.setdefault(txid, {name: 0 for name in TABLES})[table] += 1
    expected = {}
    for message in data["transaction"]:
        if not message or message.get("status") != "END":
            continue
        identity = str(message.get("id", ""))
        if not re.fullmatch(r"\d+:\d+", identity):
            raise RuntimeError("invalid transaction END identity")
        txid = int(identity.split(":", 1)[0])
        counts = {table: 0 for table in TABLES}
        for collection in message.get("data_collections") or []:
            name = collection.get("data_collection", "")
            if name.startswith("public.") and name[7:] in counts:
                counts[name[7:]] += collection.get("event_count", 0)
        if txid in expected and expected[txid] != counts:
            raise RuntimeError("conflicting transaction END records")
        expected[txid] = counts
    if not actual or any(expected.get(txid) != counts for txid, counts in actual.items()):
        raise RuntimeError("stream transaction END counts do not match row changes")
    return len(actual)


def baseline():
    record = read_state()
    active = set(run(BASE + ["ps", "--status", "running", "--services"]).splitlines())
    if active != {"connect", "kafka", "postgres"}:
        raise RuntimeError("source writes must be frozen for baseline reconciliation")
    status = connector_api("/" + CONNECTOR + "/status")
    if status.get("connector", {}).get("state") != "RUNNING" or not status.get("tasks") or any(
            task.get("state") != "RUNNING" for task in status["tasks"]):
        raise RuntimeError("recovery connector is not running")
    data = read_topics(include_transaction=False)
    snapshot = {table: [message for message in data[table]
                        if message is not None and message.get("op") == "r"] for table in TABLES}
    if not any(message.get("source", {}).get("snapshot") == "last"
               for rows in snapshot.values() for message in rows):
        raise RuntimeError("initial snapshot completion marker has not arrived")
    if any(message is not None and message.get("op") != "r"
           for table in TABLES for message in data[table]):
        raise RuntimeError("stream changes appeared before frozen-source baseline gate")
    baseline_state = projections(data)
    source = source_state()
    expected = {name: {row["id"]: row for row in source[name]}
                for name in ("orders", "links", "carts")}
    if baseline_state != expected:
        raise RuntimeError("snapshot rows differ from frozen source state")
    slot = slot_state()
    if slot["new"] not in ("reserved", "extended") or slot["old"] != "lost":
        raise RuntimeError("recovery slot is not usable or old lineage changed")
    pairs = active_pairs(baseline_state)
    result = {"status": "BASELINE_VERIFIED", "coverage_epoch_id": record["coverage_epoch_id"],
              "gap_status": "INCOMPLETE", "snapshot_rows": {table: len(snapshot[table]) for table in TABLES},
              "baseline_active_orders": len(pairs), "baseline_digest": digest_pairs(pairs),
              "snapshot_on_facts": 0, "slot_status": slot["new"]}
    record.update(result)
    STATE.write_text(json.dumps(record, sort_keys=True) + "\n", encoding="utf-8")
    return result


def transition(order_ids):
    record = read_state()
    if record.get("status") != "BASELINE_VERIFIED":
        raise RuntimeError("baseline has not been verified")
    slot = slot_state()
    if slot["old"] != "lost" or slot["new"] not in ("reserved", "extended"):
        raise RuntimeError("recovery slot is lost or no longer isolated from the old epoch")
    status = connector_api("/" + CONNECTOR + "/status")
    if status.get("connector", {}).get("state") != "RUNNING" or not status.get("tasks") or any(
            task.get("state") != "RUNNING" for task in status["tasks"]):
        raise RuntimeError("recovery connector is not running")
    data = read_topics()
    snapshot_only = {table: [message for message in data[table]
                             if message is not None and message.get("op") == "r"] for table in TABLES}
    snapshot_only["transaction"] = []
    old_pairs = active_pairs(projections(snapshot_only))
    if digest_pairs(old_pairs) != record["baseline_digest"]:
        raise RuntimeError("snapshot baseline changed after verification")
    current = active_pairs(projections(data))
    source = source_state()
    expected = active_pairs({name: {row["id"]: row for row in source[name]}
                             for name in ("orders", "links", "carts")})
    if current != expected:
        raise RuntimeError("stream materialization differs from source current state")
    changed = {key: value for key, value in current.items() if old_pairs.get(key) != value}
    removed = set(old_pairs) - set(current)
    if set(changed) != set(order_ids) or any(order_id in old_pairs for order_id in order_ids) or removed:
        raise RuntimeError("post-snapshot ON transitions do not match expected orders")
    transaction_count = validate_transaction_ends(data)
    result = {"status": "TRANSITION_VERIFIED", "coverage_epoch_id": record["coverage_epoch_id"],
              "baseline_active_orders": len(old_pairs), "current_active_orders": len(current),
              "snapshot_on_facts": 0, "post_snapshot_on_facts": len(changed),
              "post_snapshot_off_facts": len(removed), "transaction_end_covered": True,
              "processed_stream_transactions": transaction_count,
              "current_digest": digest_pairs(current), "gap_status": "INCOMPLETE"}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("setup", "constrain-columns", "diagnose", "baseline", "transition"))
    parser.add_argument("--expect-order", action="append")
    args = parser.parse_args()
    if os.environ.get("COMPOSE_PROJECT_NAME") != PROJECT:
        parser.error(f"COMPOSE_PROJECT_NAME must be {PROJECT}")
    if args.phase == "transition" and (not args.expect_order or
            any(not ORDER_ID.fullmatch(value) for value in args.expect_order) or
            len(args.expect_order) != len(set(args.expect_order))):
        parser.error("transition requires unique --expect-order order_ID values")
    result = (setup() if args.phase == "setup" else
              constrain_snapshot_columns() if args.phase == "constrain-columns" else
              diagnose() if args.phase == "diagnose" else
              baseline() if args.phase == "baseline" else transition(args.expect_order))
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired) as error:
        raise SystemExit(f"cdc10-rebaseline: {error}") from None
