#!/usr/bin/env python3
"""Register the CDC-11 target Connect profiles against private Medusa PostgreSQL.

Source roles/publications must first be prepared by install-target-source.py.
The script owns only three shadow connectors. It never activates analytical
bindings, drops a source slot, or displays source credentials.
"""

import argparse
import importlib.util
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("target_source_installer", ROOT / "install-target-source.py")
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)

CONNECTORS = {
    "order": "medusa-cdc-order-v2-shadow-e1",
    "catalog": "medusa-cdc-catalog-shadow-e1",
    "inventory_price": "medusa-cdc-inventory-price-shadow-e1",
    "cart": "medusa-cdc-cart-line-item-v1",
}
API = "http://127.0.0.1:8083/connectors"


def rest(container, path="", payload=None, method="GET"):
    command = ["docker", "exec", "-i", container, "curl", "-fsS", "--max-time", "20",
               "-H", "Content-Type: application/json", "-X", method]
    if payload is not None:
        command += ["--data-binary", "@-"]
    command += [API + path]
    result = subprocess.run(command, input=json.dumps(payload) if payload is not None else None,
                            text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError(f"private Connect REST request failed (exit {result.returncode}); inspect protected logs")
    return json.loads(result.stdout) if result.stdout else None


def credential(state_dir, name, document):
    path = state_dir / f"{name}.env"
    if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise ValueError(f"{name}: protected credential is missing")
    lines = path.read_text(encoding="utf-8").splitlines()
    if len(lines) != 1 or not lines[0].startswith(document["source_db_url_ref"] + "="):
        raise ValueError(f"{name}: credential reference drifted")
    value = urlparse(lines[0].split("=", 1)[1])
    role = source.SPECS[name][2]
    if (value.scheme != "postgresql" or value.username != role or
            value.hostname != "medusa-cdc-postgres" or value.port != 5432 or
            value.path != "/medusa" or value.query or value.fragment or
            not re.fullmatch(r"[a-f0-9]{64}", value.password or "")):
        raise ValueError(f"{name}: credential target/format differs from source profile")
    return value.password


def config(name, document, password):
    columns = [entry.split(":", 1) for entry in document["table_columns"]]
    result = {
        "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
        "tasks.max": "1", "database.hostname": "medusa-cdc-postgres",
        "database.port": "5432", "database.user": source.SPECS[name][2],
        "database.password": password, "database.dbname": "medusa",
        "topic.prefix": document["topic_prefix"], "plugin.name": "pgoutput",
        "slot.name": document["slot"], "slot.drop.on.stop": "false",
        "publication.name": document["publication"],
        "publication.autocreate.mode": "disabled",
        "table.include.list": ",".join(table for table, _ in columns),
        "column.include.list": ",".join(f"{table}.{field}" for table, fields in columns
                                        for field in fields.split(",")),
        "snapshot.mode": "initial", "provide.transaction.metadata": "true",
        "heartbeat.interval.ms": "10000", "decimal.handling.mode": "string",
        "key.converter": "org.apache.kafka.connect.json.JsonConverter",
        "key.converter.schemas.enable": "false",
        "value.converter": "org.apache.kafka.connect.json.JsonConverter",
        "value.converter.schemas.enable": "false",
    }
    return result


def verify_one(connect_container, source_container, state_dir, name, document):
    source.verify_one(source_container, state_dir, name, document)
    password = credential(state_dir, name, document)
    connector = CONNECTORS[name]
    if connector not in rest(connect_container):
        raise ValueError(f"{name}: Connect registration is absent")
    current = rest(connect_container, "/" + connector + "/config")
    expected = config(name, document, password)
    if {key: value for key, value in current.items() if key != "name"} != expected:
        raise ValueError(f"{name}: Connect configuration drifted")
    status = rest(connect_container, "/" + connector + "/status")
    if status.get("connector", {}).get("state") != "RUNNING" or not status.get("tasks") or \
            any(task.get("state") != "RUNNING" for task in status["tasks"]):
        raise ValueError(f"{name}: Connect task is not RUNNING")
    slot = source.run_psql(source_container,
        "SELECT COALESCE(json_agg(json_build_object('plugin',plugin,'database',database,"
        "'wal_status',wal_status,'active',active))::text,'[]') FROM pg_replication_slots "
        f"WHERE slot_name='{document['slot']}';")
    rows = json.loads(slot)
    if len(rows) != 1 or rows[0]["plugin"] != "pgoutput" or rows[0]["database"] != "medusa" or \
            rows[0]["wal_status"] not in ("reserved", "extended"):
        raise ValueError(f"{name}: source replication slot is missing or unsafe")
    return {"profile": name, "status": "CONNECT_RUNNING", "slot_active": rows[0]["active"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("plan", "apply", "verify", "rollback"))
    parser.add_argument("--profile-dir", type=Path, required=True)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--postgres-container", required=True)
    parser.add_argument("--connect-container", required=True)
    parser.add_argument("--profile", choices=tuple(source.SPECS), required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"medusa_reference-postgres-[0-9]+", args.postgres_container) or \
            not re.fullmatch(r"[a-f0-9]{12,64}", args.connect_container):
        raise ValueError("explicit source/Connect container identifiers required")
    source.private_directory(args.state_dir)
    profiles = source.load_profiles(args.profile_dir, (args.profile,))
    document = profiles[args.profile]
    name = args.profile
    if args.command == "plan":
        result = {"status": "CONNECT_PLAN_ONLY", "profile": name,
                  "profile_sha256": source.digest(document), "connector": CONNECTORS[name],
                  "slot": document["slot"], "snapshot_mode": "initial"}
    elif args.command == "apply":
        source.source_preflight(args.postgres_container, {name: document})
        source.verify_one(args.postgres_container, args.state_dir, name, document)
        password = credential(args.state_dir, name, document)
        connector = CONNECTORS[name]
        names = rest(args.connect_container)
        if connector in names:
            raise ValueError(f"{name}: connector already exists; verify ownership instead")
        if source.resources(args.postgres_container, source.SPECS[name][2], document["slot"])["slot"]:
            raise ValueError(f"{name}: slot exists without connector; recovery required")
        # Connect creates the slot and initial snapshot. Do not manually advance it.
        rest(args.connect_container, payload={"name": connector,
                                              "config": config(name, document, password)}, method="POST")
        result = {"status": "CONNECT_REGISTERED", "profile": name,
                  "snapshot_coverage": "NOT_YET_VERIFIED"}
    elif args.command == "verify":
        result = verify_one(args.connect_container, args.postgres_container,
                            args.state_dir, name, document)
    else:
        source.verify_one(args.postgres_container, args.state_dir, name, document)
        password = credential(args.state_dir, name, document)
        connector = CONNECTORS[name]
        if connector not in rest(args.connect_container):
            raise ValueError(f"{name}: connector absent; rollback cannot prove ownership")
        current = rest(args.connect_container, "/" + connector + "/config")
        if {key: value for key, value in current.items() if key != "name"} != config(name, document, password):
            raise ValueError(f"{name}: connector config drifted; refusing deletion")
        rest(args.connect_container, "/" + connector, method="DELETE")
        result = {"status": "CONNECT_STOPPED", "profile": name,
                  "retained": ["publication", "slot", "topics", "source_credentials"]}
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"cdc-target-connect: {error}") from None
