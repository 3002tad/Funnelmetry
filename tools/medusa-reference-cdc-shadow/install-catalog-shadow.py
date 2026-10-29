#!/usr/bin/env python3
"""Install the separate catalog CDC *source* connector on an isolated Medusa clone.

This never activates a live source or the Dashboard binding. The approved
order-state v1 publication/slot/topic are outside its ownership boundary.
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import time
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
PROJECT = os.environ.get("COMPOSE_PROJECT_NAME", "")
PROJECT_PATTERN = (r"(?:funnelmetry_cdc_catalog_shadow_|"
                   r"funnelmetry_cdc_combined_shadow_)[a-z0-9][a-z0-9_-]{0,32}")
COMPOSE = ["docker", "compose", "-f", str(ROOT / "compose.yml")]
STATE = ROOT / "private" / "cdc-catalog-installer-state.json"
SECRET = ROOT / "private" / "catalog-connector.env"
CONNECTOR = "medusa-cdc-catalog-shadow"
PREFIX = "cdc_shadow_medusa_catalog"
SLOT = "funnelmetry_cdc_catalog_shadow"
PUBLICATION = "funnelmetry_cdc_catalog_shadow"
ROLE = "cdc_catalog"
TABLES = {
    "product": ("id", "title", "handle", "status", "collection_id", "updated_at", "deleted_at"),
    "product_variant": ("id", "product_id", "title", "sku", "manage_inventory", "allow_backorder", "updated_at", "deleted_at"),
    "product_category": ("id", "name", "parent_category_id", "is_active", "is_internal", "updated_at", "deleted_at"),
    "product_category_product": ("product_id", "product_category_id"),
}
PRIMARY_KEYS = {}
TABLE_COLUMNS = [f"public.{table}:{','.join(columns)}" for table, columns in TABLES.items()]
EXPECTED = {
    "schema_version": "funnelmetry-medusa-cdc-catalog-shadow.v1",
    "generated_by": "funnelmetry-medusa-ci", "status": "SHADOW_ONLY",
    "source_id": "medusa-reference", "medusa_version": "2.19.0",
    "cdc_catalog_contract": "reference.medusa.catalog_master_data.v1",
    "source_db_url_ref": "FUNNELMETRY_CDC_CATALOG_DATABASE_URL",
    "snapshot_mode": "initial", "publication": PUBLICATION, "slot": SLOT,
    "topic_prefix": PREFIX, "table_columns": TABLE_COLUMNS,
    "projection_stage": "PRODUCT_VARIANT_CATEGORY_ONLY",
    "inventory_price_claims": "NOT_SUPPORTED",
    "dashboard_cutover": "BLOCKED_PENDING_COVERAGE_AND_FRESHNESS",
    "runtime_activation": "OPERATOR_CONTROLLED_SEPARATE_FROM_INSTALLER",
}


def configure_profile(*, project_pattern, state, secret, connector, prefix,
                      slot, publication, role, tables, expected, primary_keys=None):
    """Reuse guarded table-CDC installation with an independently pinned profile.

    The caller must set every owned resource and exact allowlist before invoking
    plan/apply/verify/rollback. The catalog defaults remain unchanged.
    """
    global PROJECT_PATTERN, STATE, SECRET, CONNECTOR, PREFIX, SLOT, PUBLICATION
    global ROLE, TABLES, TABLE_COLUMNS, EXPECTED, PRIMARY_KEYS
    PROJECT_PATTERN = project_pattern
    STATE, SECRET, CONNECTOR, PREFIX = state, secret, connector, prefix
    SLOT, PUBLICATION, ROLE = slot, publication, role
    TABLES = tables
    PRIMARY_KEYS = primary_keys or {}
    TABLE_COLUMNS = [f"public.{table}:{','.join(columns)}" for table, columns in tables.items()]
    EXPECTED = expected


def profile(path):
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    return profile_dict(value)


def profile_dict(value):
    if not isinstance(value, dict) or set(value) != set(EXPECTED) | {"source_owner", "pipeline_owner"}:
        raise ValueError("catalog profile fields differ from version 1")
    if any(value[key] != expected for key, expected in EXPECTED.items()):
        raise ValueError("catalog profile differs from exact initial-snapshot allowlist")
    if any(not isinstance(value[key], str) or not value[key].strip()
           for key in ("source_owner", "pipeline_owner")):
        raise ValueError("catalog profile owners are required")
    return value


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def run(command, *, stdin=None):
    result = subprocess.run(command, input=stdin, text=True, capture_output=True, check=False)
    if result.returncode:
        # Docker, SQL and Connect errors can contain URLs or credentials.
        raise RuntimeError(f"isolated catalog command failed (exit {result.returncode}); inspect protected logs")
    return result.stdout.strip()


def compose(*args, stdin=None):
    return run(COMPOSE + list(args), stdin=stdin)


def sql(statement):
    return compose("exec", "-T", "postgres", "psql", "-X", "-U", "medusa",
                   "-d", "medusa", "-At", "-v", "ON_ERROR_STOP=1", stdin=statement)


def connect(path="", *, payload=None, method="GET"):
    args = ["exec", "-T", "connect", "curl", "-fsS", "--max-time", "15",
            "-H", "Content-Type: application/json", "-X", method]
    if payload is not None:
        args += ["--data-binary", "@-"]
    output = compose(*args, f"http://127.0.0.1:8083/connectors{path}",
                     stdin=json.dumps(payload) if payload is not None else None)
    return json.loads(output) if output else None


def wait_connect(timeout_seconds=45):
    deadline = time.monotonic() + timeout_seconds
    while True:
        try:
            return connect()
        except RuntimeError:
            if time.monotonic() >= deadline:
                raise RuntimeError("isolated Debezium Connect did not become ready") from None
            time.sleep(1)


def topology():
    if not re.fullmatch(PROJECT_PATTERN, PROJECT):
        raise ValueError("COMPOSE_PROJECT_NAME must identify the profile's separate shadow clone")
    config = json.loads(compose("config", "--format", "json"))
    if config.get("name") != PROJECT or not config.get("networks") or any(
            not network.get("internal") for network in config["networks"].values()):
        raise ValueError("catalog shadow Compose network is not isolated")
    services = config.get("services", {})
    if not {"postgres", "kafka", "connect"}.issubset(services) or any(
            service.get("ports") or service.get("network_mode") or
            set(service.get("networks", {})) - set(config["networks"])
            for service in services.values()):
        raise ValueError("catalog shadow topology exposes a service or lacks CDC services")


def password(document):
    if SECRET.is_symlink() or not SECRET.is_file() or SECRET.stat().st_mode & 0o077:
        raise ValueError(f"{SECRET.name} must be a mode-600 file")
    fields = dict(line.split("=", 1) for line in SECRET.read_text(encoding="utf-8").splitlines()
                  if line and not line.startswith("#") and "=" in line)
    value = urlparse(fields.get(document["source_db_url_ref"], ""))
    if (value.scheme not in ("postgres", "postgresql") or value.hostname != "postgres"
        or value.port != 5432 or value.username != ROLE or value.path != "/medusa"
        or value.query or value.fragment or not value.password
        or not re.fullmatch(r"[A-Za-z0-9]{16,128}", value.password)):
        raise ValueError(f"profile secret must target {ROLE}@postgres:5432/medusa")
    return value.password


def source_state():
    if sql("SELECT current_database() || '|' || current_setting('wal_level');") != "medusa|logical":
        raise ValueError("expected a logical-WAL Medusa clone")
    for table, columns in TABLES.items():
        actual = set(json.loads(sql(f"SELECT COALESCE(json_agg(column_name)::text,'[]') "
                                    "FROM information_schema.columns WHERE table_schema='public' "
                                    f"AND table_name='{table}';")))
        if not set(columns).issubset(actual):
            raise ValueError(f"clone lacks approved {table} columns")
        if table in PRIMARY_KEYS:
            query = ("SELECT COALESCE(json_agg(k.column_name ORDER BY k.ordinal_position)"
                     "::text,'[]') FROM information_schema.table_constraints AS c "
                     "JOIN information_schema.key_column_usage AS k ON "
                     "k.constraint_name=c.constraint_name AND "
                     "k.table_schema=c.table_schema AND k.table_name=c.table_name "
                     "WHERE c.constraint_type='PRIMARY KEY' AND c.table_schema='public' "
                     f"AND c.table_name='{table}';")
            if json.loads(sql(query)) != list(PRIMARY_KEYS[table]):
                raise ValueError(f"clone {table} primary key differs from approved scope")
    slots = json.loads(sql(f"SELECT COALESCE(json_agg(json_build_object('plugin',plugin,"
                           "'database',database,'wal_status',wal_status))::text,'[]') "
                           f"FROM pg_replication_slots WHERE slot_name='{SLOT}';"))
    if slots and (len(slots) != 1 or slots[0]["plugin"] != "pgoutput" or
                  slots[0]["database"] != "medusa" or
                  slots[0]["wal_status"] not in ("reserved", "extended")):
        raise ValueError("catalog slot is foreign or has unsafe WAL status")
    return bool(slots)


def publication_state():
    flags = sql(f"SELECT puballtables::int || '|' || pubinsert::int || '|' || "
                "pubupdate::int || '|' || pubdelete::int || '|' || pubtruncate::int "
                f"FROM pg_publication WHERE pubname='{PUBLICATION}';")
    if not flags:
        return "absent"
    if flags != "0|1|1|1|0":
        raise ValueError("catalog publication operations drifted")
    rows = json.loads(sql("SELECT COALESCE(json_agg(json_build_object('table',"
                          "schemaname||'.'||tablename,'columns',attnames) "
                          "ORDER BY tablename)::text,'[]') FROM pg_publication_tables "
                          f"WHERE pubname='{PUBLICATION}';"))
    actual = {row["table"]: set(row["columns"]) for row in rows}
    if len(rows) != len(TABLES) or actual != {
            f"public.{table}": set(columns) for table, columns in TABLES.items()}:
        raise ValueError("catalog publication column allowlist drifted")
    return "exact"


def connector_config(secret):
    return {
        "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
        "tasks.max": "1", "database.hostname": "postgres", "database.port": "5432",
        "database.user": ROLE, "database.password": secret, "database.dbname": "medusa",
        "topic.prefix": PREFIX, "plugin.name": "pgoutput", "slot.name": SLOT,
        "slot.drop.on.stop": "false", "publication.name": PUBLICATION,
        "publication.autocreate.mode": "disabled",
        "table.include.list": ",".join(f"public.{table}" for table in TABLES),
        "column.include.list": ",".join(f"public.{table}.{column}"
                                           for table, columns in TABLES.items() for column in columns),
        "snapshot.mode": "initial", "provide.transaction.metadata": "true",
        "heartbeat.interval.ms": "10000", "decimal.handling.mode": "string",
        "key.converter": "org.apache.kafka.connect.json.JsonConverter",
        "key.converter.schemas.enable": "false",
        "value.converter": "org.apache.kafka.connect.json.JsonConverter",
        "value.converter.schemas.enable": "false",
    }


def connector_state(secret):
    if CONNECTOR not in connect():
        return "absent"
    current = connect(f"/{CONNECTOR}/config")
    if {key: value for key, value in current.items() if key != "name"} != connector_config(secret):
        raise ValueError("catalog connector configuration drifted")
    return "exact"


def read_state(document):
    if not STATE.exists():
        return None
    if STATE.is_symlink() or STATE.stat().st_mode & 0o077:
        raise ValueError("catalog installer ownership state is not private")
    value = json.loads(STATE.read_text(encoding="utf-8"))
    if value.get("profile_sha256") != digest(document) or value.get("project") != PROJECT:
        raise ValueError("catalog installer ownership state differs")
    return value


def write_state(document, status):
    value = {"profile_sha256": digest(document), "project": PROJECT,
             "connector": CONNECTOR, "publication": PUBLICATION, "slot": SLOT,
             "topic_prefix": PREFIX, "status": status}
    if STATE.exists() and (STATE.is_symlink() or STATE.stat().st_mode & 0o077):
        raise ValueError("catalog installer ownership state is not private")
    temporary = STATE.with_suffix(".json.tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(json.dumps(value, sort_keys=True) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, STATE)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def bootstrap(secret):
    status = publication_state()
    role = sql(f"SELECT rolcanlogin::int || '|' || rolreplication::int "
               f"FROM pg_roles WHERE rolname='{ROLE}';")
    if role and role != "1|1":
        raise ValueError("catalog replication role lacks required capabilities")
    if not role:
        sql(f"CREATE ROLE {ROLE} WITH LOGIN REPLICATION PASSWORD '{secret}';")
    sql(f"GRANT USAGE ON SCHEMA public TO {ROLE};")
    for table, columns in TABLES.items():
        sql(f"GRANT SELECT ({','.join(columns)}) ON public.{table} TO {ROLE};")
    if status == "absent":
        tables = ", ".join(f"public.{table} ({','.join(columns)})"
                           for table, columns in TABLES.items())
        sql(f"CREATE PUBLICATION {PUBLICATION} FOR TABLE {tables} "
            "WITH (publish='insert,update,delete');")
    if publication_state() != "exact":
        raise ValueError("catalog publication postcondition failed")


def apply(document):
    topology()
    secret = password(document)
    exists = source_state()
    state = read_state(document)
    if state and state["status"] == "ACTIVE" and not exists:
        raise ValueError("owned catalog slot disappeared; recovery epoch required")
    if exists and state is None:
        raise ValueError("catalog slot exists without installer ownership")
    wait_connect()
    connector = connector_state(secret)
    if connector == "exact" and state is None:
        raise ValueError("catalog connector exists without installer ownership")
    bootstrap(secret)
    if connector == "absent":
        connect(payload={"name": CONNECTOR, "config": connector_config(secret)}, method="POST")
    write_state(document, "ACTIVE")
    return {"status": "applied", "profile_sha256": digest(document),
            "snapshot_mode": "initial", "dashboard_cutover": "BLOCKED"}


def verify(document):
    topology()
    secret = password(document)
    wait_connect()
    state = read_state(document)
    if not state or state["status"] != "ACTIVE" or not source_state() or \
            publication_state() != "exact" or connector_state(secret) != "exact":
        raise ValueError("catalog source/connector installation is incomplete")
    status = connect(f"/{CONNECTOR}/status")
    if status.get("connector", {}).get("state") != "RUNNING" or not status.get("tasks") or any(
            task.get("state") != "RUNNING" for task in status["tasks"]):
        raise ValueError("catalog connector/task is not RUNNING")
    return {"status": "pass", "snapshot_coverage": "NOT_CHECKED_BY_INSTALLER",
            "dashboard_cutover": "BLOCKED"}


def rollback(document):
    topology()
    secret = password(document)
    state = read_state(document)
    if not state:
        raise ValueError("catalog connector has no installer ownership")
    if connector_state(secret) == "exact":
        connect(f"/{CONNECTOR}", method="DELETE")
    write_state(document, "STOPPED")
    return {"status": "stopped", "retained": ["slot", "publication", "topics", "volumes", "credentials"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("plan", "apply", "verify", "rollback"))
    parser.add_argument("--profile", required=True)
    args = parser.parse_args()
    document = profile(args.profile)
    if args.command == "plan":
        result = {"status": "planned", "project": PROJECT, "profile_sha256": digest(document),
                  "source_db_secret_ref": document["source_db_url_ref"],
                  "tables": list(TABLES), "snapshot_mode": "initial",
                  "actions": ["clone Medusa DB", "create exact column publication",
                              "register isolated initial-snapshot connector", "reconcile projection"],
                  "dashboard_cutover": "BLOCKED"}
    elif args.command == "apply":
        result = apply(document)
    elif args.command == "verify":
        result = verify(document)
    else:
        result = rollback(document)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"cdc-catalog-shadow-installer: {error}") from None
