#!/usr/bin/env python3
"""Add order.deleted_at only to the isolated shadow CDC publication."""

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
COMPOSE = ["docker", "compose", "-f", str(ROOT / "compose.yml")]
PUBLICATION = "funnelmetry_cdc_shadow"
OLD_COLUMNS = {"id", "status", "currency_code", "created_at", "updated_at"}
OTHER_COLUMNS = {
    "cart": {"id", "currency_code", "completed_at"},
    "order_cart": {"order_id", "cart_id", "id", "created_at"},
    "order_summary": {"id", "order_id", "totals", "created_at", "updated_at"},
    "order_item": {"id", "order_id", "item_id", "quantity", "unit_price", "created_at"},
    "order_line_item": {"id", "product_id", "variant_id", "unit_price", "created_at"},
}


def sql(statement):
    result = subprocess.run(
        COMPOSE + ["exec", "-T", "postgres", "psql", "-X", "-U", "medusa", "-d", "medusa",
                   "-At", "-v", "ON_ERROR_STOP=1"],
        input=statement, capture_output=True, text=True, check=False,
    )
    if result.returncode:
        raise RuntimeError(f"shadow PostgreSQL statement failed (exit {result.returncode})")
    return result.stdout.strip()


if sql("SELECT current_database() || '|' || current_setting('wal_level');") != "medusa|logical":
    raise RuntimeError("expected the isolated logical-WAL shadow database")

rows = sql(f"SELECT tablename || '|' || array_to_string(attnames, ',') FROM pg_publication_tables WHERE pubname='{PUBLICATION}' ORDER BY tablename;")
published = {}
for line in rows.splitlines():
    table, columns = line.split("|", 1)
    published[table] = set(columns.split(","))
if set(published) != {"order", *OTHER_COLUMNS}:
    raise RuntimeError("unexpected shadow publication tables; refusing to change publication")
if any(published[table] != columns for table, columns in OTHER_COLUMNS.items()):
    raise RuntimeError("other shadow publication columns differ; refusing to change publication")
if published["order"] == OLD_COLUMNS | {"deleted_at"}:
    print("shadow publication already includes order.deleted_at")
elif published["order"] == OLD_COLUMNS:
    sql(f"""
ALTER PUBLICATION {PUBLICATION} SET TABLE
  public."order" (id, status, currency_code, created_at, updated_at, deleted_at),
  public.cart (id, currency_code, completed_at),
  public.order_cart (order_id, cart_id, id, created_at),
  public.order_summary (id, order_id, totals, created_at, updated_at),
  public.order_item (id, order_id, item_id, quantity, unit_price, created_at),
  public.order_line_item (id, product_id, variant_id, unit_price, created_at);
""")
    print("added order.deleted_at to isolated shadow publication")
else:
    raise RuntimeError("unexpected order column allowlist; refusing to change publication")

final = sql(f"SELECT array_to_string(attnames, ',') FROM pg_publication_tables WHERE pubname='{PUBLICATION}' AND tablename='order';")
if set(final.split(",")) != OLD_COLUMNS | {"deleted_at"}:
    raise RuntimeError("post-change publication verification failed")
print("verified shadow order publication columns:", final)
