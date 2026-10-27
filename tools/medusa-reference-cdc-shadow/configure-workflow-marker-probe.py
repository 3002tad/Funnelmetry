#!/usr/bin/env python3
"""Capture only non-context workflow status columns in the isolated shadow DB."""

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
COMPOSE = ["docker", "compose", "-f", str(ROOT / "compose.yml")]
PUBLICATION = "funnelmetry_workflow_shadow"
CONNECTOR = "medusa-workflow-shadow"
COLUMNS = {"id", "workflow_id", "transaction_id", "run_id", "state", "created_at", "updated_at"}


def sql(statement: str) -> str:
    result = subprocess.run(
        COMPOSE + ["exec", "-T", "postgres", "psql", "-X", "-U", "medusa", "-d", "medusa", "-At", "-v", "ON_ERROR_STOP=1"],
        input=statement, text=True, capture_output=True, check=False,
    )
    if result.returncode:
        raise SystemExit(f"shadow workflow publication failed: {result.stderr[-700:]}")
    return result.stdout.strip()


def connect_rest(path: str = "", payload: dict | None = None) -> object:
    argv = COMPOSE + ["exec", "-T", "connect", "curl", "-fsS", "--max-time", "15"]
    if payload is not None:
        argv += ["-H", "Content-Type: application/json", "-X", "POST", "--data-binary", "@-"]
    argv.append("http://127.0.0.1:8083/connectors" + path)
    result = subprocess.run(
        argv, input=json.dumps(payload) if payload is not None else None,
        text=True, capture_output=True, check=False,
    )
    if result.returncode:
        # Connect error responses can echo the password in the submitted config.
        raise SystemExit(f"Kafka Connect REST failed for workflow probe (exit {result.returncode})")
    return json.loads(result.stdout)


if sql("SHOW wal_level;") != "logical" or sql("SELECT current_database();") != "medusa":
    raise SystemExit("workflow probe requires the isolated logical-WAL Medusa clone")

password = dict(
    line.split("=", 1) for line in (ROOT / "private" / "connector.env").read_text(encoding="utf-8").splitlines() if line
)["CDC_SHADOW_REPLICATION_PASSWORD"]

sql("""
GRANT SELECT (id, workflow_id, transaction_id, run_id, state, created_at, updated_at)
ON public.workflow_execution TO cdc_shadow;
""")
exists = sql(f"SELECT count(*) FROM pg_publication WHERE pubname='{PUBLICATION}';")
if exists == "0":
    sql(f"""
CREATE PUBLICATION {PUBLICATION} FOR TABLE public.workflow_execution
  (id, workflow_id, transaction_id, run_id, state, created_at, updated_at)
WITH (publish = 'insert,update,delete');
""")
elif exists != "1":
    raise SystemExit("unexpected workflow publication inventory")

actual = sql(f"SELECT attnames FROM pg_publication_tables WHERE pubname='{PUBLICATION}' AND schemaname='public' AND tablename='workflow_execution';")
if set(actual.strip("{}").split(",")) != COLUMNS:
    raise SystemExit(f"workflow publication column mismatch: {actual}")

config = {
    "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
    "tasks.max": "1",
    "database.hostname": "postgres",
    "database.port": "5432",
    "database.user": "cdc_shadow",
    "database.password": password,
    "database.dbname": "medusa",
    "topic.prefix": "cdc_shadow_workflow",
    "plugin.name": "pgoutput",
    "slot.name": PUBLICATION,
    "slot.drop.on.stop": "false",
    "publication.name": PUBLICATION,
    "publication.autocreate.mode": "disabled",
    "table.include.list": "public.workflow_execution",
    "snapshot.mode": "no_data",
    "provide.transaction.metadata": "true",
    "heartbeat.interval.ms": "10000",
    "key.converter": "org.apache.kafka.connect.json.JsonConverter",
    "key.converter.schemas.enable": "false",
    "value.converter": "org.apache.kafka.connect.json.JsonConverter",
    "value.converter.schemas.enable": "false",
}
current = connect_rest()
if CONNECTOR in current:
    active = connect_rest(f"/{CONNECTOR}/config")
    mismatched = [key for key, value in config.items() if active.get(key) != value]
    unexpected = sorted(set(active) - set(config) - {"name"})
    if mismatched or unexpected:
        raise SystemExit(f"workflow connector differs at keys {mismatched}; unexpected keys {unexpected}")
    print("preserved existing workflow marker probe")
else:
    connect_rest(payload={"name": CONNECTOR, "config": config})
    print("registered isolated workflow marker probe")
print(f"publication={PUBLICATION},column_count={len(COLUMNS)},snapshot=no_data")
