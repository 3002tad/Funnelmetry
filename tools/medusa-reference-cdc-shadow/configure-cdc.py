#!/usr/bin/env python3
"""Create a narrow shadow publication and register one Debezium connector."""

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
COMPOSE = ["docker", "compose", "-f", str(ROOT / "compose.yml")]
CONNECT_URL = "http://127.0.0.1:8083/connectors"
CONNECTOR = "medusa-cdc-shadow"
PUBLICATION = "funnelmetry_cdc_shadow"
TABLES = "public.order,public.cart,public.order_cart,public.order_summary,public.order_item,public.order_line_item"


def read_env(name: str) -> dict[str, str]:
    return dict(line.split("=", 1) for line in (ROOT / "private" / name).read_text(encoding="utf-8").splitlines() if line)


def sql(statement: str) -> str:
    result = subprocess.run(
        COMPOSE + ["exec", "-T", "postgres", "psql", "-X", "-U", "medusa", "-d", "medusa", "-At", "-v", "ON_ERROR_STOP=1"],
        input=statement,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode:
        raise SystemExit(f"shadow PostgreSQL configuration failed: {result.stderr[-900:]}")
    return result.stdout.strip()


def connect_rest(path: str = "", payload: dict | None = None) -> object:
    argv = COMPOSE + ["exec", "-T", "connect", "curl", "-fsS", "--max-time", "15"]
    if payload is not None:
        argv += ["-H", "Content-Type: application/json", "-X", "POST", "--data-binary", "@-"]
    argv.append(CONNECT_URL + path)
    result = subprocess.run(
        argv,
        input=json.dumps(payload) if payload is not None else None,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode:
        # Kafka Connect can echo the submitted config, including the password,
        # in error bodies. Never print stdout/stderr from this call.
        raise SystemExit(f"Kafka Connect REST failed for {path or '/'} (exit {result.returncode})")
    return json.loads(result.stdout)


if sql("SHOW wal_level;") != "logical":
    raise SystemExit("refusing to configure CDC on a PostgreSQL instance without logical WAL")
if sql("SELECT current_database();") != "medusa":
    raise SystemExit("unexpected database")

password = read_env("connector.env")["CDC_SHADOW_REPLICATION_PASSWORD"]
if not password.isascii() or not password.isalnum():
    raise SystemExit("replication password must be alphanumeric for SQL quoting")

sql(f"""
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cdc_shadow') THEN
    CREATE ROLE cdc_shadow WITH LOGIN REPLICATION PASSWORD '{password}';
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO cdc_shadow;
GRANT SELECT ON TABLE public."order", public.cart, public.order_cart,
  public.order_summary, public.order_item, public.order_line_item TO cdc_shadow;
""")

publication_exists = sql(f"SELECT count(*) FROM pg_publication WHERE pubname='{PUBLICATION}';")
if publication_exists == "0":
    sql(f"""
CREATE PUBLICATION {PUBLICATION} FOR TABLE
  public."order" (id, status, currency_code, created_at, updated_at),
  public.cart (id, currency_code, completed_at),
  public.order_cart (order_id, cart_id, id, created_at),
  public.order_summary (id, order_id, totals, created_at, updated_at),
  public.order_item (id, order_id, item_id, quantity, unit_price, created_at),
  public.order_line_item (id, product_id, variant_id, unit_price, created_at)
WITH (publish = 'insert,update,delete');
""")
elif publication_exists != "1":
    raise SystemExit("unexpected publication inventory")

publication_tables = sql(f"SELECT count(*) FROM pg_publication_tables WHERE pubname='{PUBLICATION}';")
if publication_tables != "6":
    raise SystemExit(f"publication has {publication_tables} tables, expected six")

config = {
    "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
    "tasks.max": "1",
    "database.hostname": "postgres",
    "database.port": "5432",
    "database.user": "cdc_shadow",
    "database.password": password,
    "database.dbname": "medusa",
    "topic.prefix": "cdc_shadow_medusa",
    "plugin.name": "pgoutput",
    "slot.name": PUBLICATION,
    "slot.drop.on.stop": "false",
    "publication.name": PUBLICATION,
    "publication.autocreate.mode": "disabled",
    "table.include.list": TABLES,
    "snapshot.mode": "no_data",
    "provide.transaction.metadata": "true",
    "heartbeat.interval.ms": "10000",
    "decimal.handling.mode": "string",
    "key.converter": "org.apache.kafka.connect.json.JsonConverter",
    "key.converter.schemas.enable": "false",
    "value.converter": "org.apache.kafka.connect.json.JsonConverter",
    "value.converter.schemas.enable": "false",
}

current = connect_rest()

if CONNECTOR in current:
    active = connect_rest(f"/{CONNECTOR}/config")
    if active != config:
        raise SystemExit("connector exists with different config; refusing silent replacement")
    print("preserved existing CDC shadow connector")
else:
    connect_rest(payload={"name": CONNECTOR, "config": config})
    print("registered isolated CDC shadow connector")

print(f"publication={PUBLICATION},tables={publication_tables},snapshot=no_data,topic_prefix=cdc_shadow_medusa")
