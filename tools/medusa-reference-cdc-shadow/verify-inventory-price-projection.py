#!/usr/bin/env python3
"""Reconcile stage-2 shadow row keys, soft-delete state and input offsets.

The check does not certify sellable stock, display price or a live cutover.
"""

import argparse
import importlib.util
import json
import os
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("snapshot_check", ROOT / "verify-inventory-price-snapshot.py")
snapshot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(snapshot)
TABLES = snapshot.TABLES
BASE = snapshot.BASE
PROJECTION = BASE + ["-f", str(ROOT / "compose.inventory-price-projection.yml")]
KEYS = {
    "product_sales_channel": ("product_id", "sales_channel_id"),
    "sales_channel_stock_location": ("sales_channel_id", "stock_location_id"),
    "product_variant_inventory_item": ("variant_id", "inventory_item_id"),
    "product_variant_price_set": ("variant_id", "price_set_id"),
    "currency": ("code",),
}
SOFT_DELETE = set(TABLES)
ATTRIBUTES = {
    "product_sales_channel": ("id", "product_id", "sales_channel_id"),
    "sales_channel": ("id", "name", "is_disabled"),
    "sales_channel_stock_location": ("id", "sales_channel_id", "stock_location_id"),
    "stock_location": ("id", "name"),
    "product_variant_inventory_item": ("id", "variant_id", "inventory_item_id", "required_quantity"),
    "inventory_item": ("id", "sku", "requires_shipping"),
    "inventory_level": ("id", "inventory_item_id", "location_id", "stocked_quantity",
                        "reserved_quantity", "incoming_quantity"),
    "reservation_item": ("id", "inventory_item_id", "location_id", "quantity", "allow_backorder"),
    "product_variant_price_set": ("id", "variant_id", "price_set_id"),
    "price_set": ("id",),
    "price": ("id", "price_set_id", "currency_code", "amount", "price_list_id",
              "min_quantity", "max_quantity", "rules_count"),
    "price_list": ("id", "status", "type", "rules_count"),
    "price_rule": ("id", "price_id", "attribute", "operator", "value", "priority"),
    "price_list_rule": ("id", "price_list_id", "attribute"),
    "region": ("id", "currency_code"),
    "currency": ("code", "decimal_digits"),
}


def query(compose, service, user, database, statement):
    result = subprocess.run(compose + ["exec", "-T", service, "psql", "-X", "-U", user,
                                       "-d", database, "-At", "-v", "ON_ERROR_STOP=1",
                                       "-c", statement], text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError("isolated inventory/price projection query failed")
    return json.loads(result.stdout.strip())


def source_rows():
    parts = []
    for table in TABLES:
        key = ",".join(KEYS.get(table, ("id",)))
        deleted = "deleted_at IS NOT NULL" if table in SOFT_DELETE else "false"
        attributes = ",".join(f"'{field}',{field}::text" for field in ATTRIBUTES[table])
        parts.append(f"'{table}',(SELECT COALESCE(jsonb_agg(jsonb_build_object('key',"
                     f"jsonb_build_array({key}),'soft_deleted',{deleted},"
                     f"'attributes',jsonb_build_object({attributes}))),'[]'::jsonb) "
                     f"FROM public.{table})")
    statement = "SELECT jsonb_build_object(" + ",".join(parts) + ")::text;"
    return query(BASE, "postgres", "medusa", "medusa", statement)


def projection_rows():
    epoch = os.environ.get("CDC_COVERAGE_EPOCH", "")
    if not epoch or not all(char.isalnum() or char in "_-" for char in epoch):
        raise ValueError("CDC_COVERAGE_EPOCH must be set for projection verification")
    statement = ("SELECT COALESCE(jsonb_object_agg(table_name,rows),'{}'::jsonb)::text "
                 "FROM (SELECT table_name,jsonb_agg(jsonb_build_object('key',row_key,"
                 "'soft_deleted',soft_deleted,'payload',payload)) AS rows FROM context_rows_current "
                 f"WHERE coverage_epoch_id='{epoch}' AND source_id='medusa-reference' "
                 "GROUP BY table_name) AS grouped;")
    return query(PROJECTION, "inventory-price-projection-db", "inventory_price_projection",
                 "inventory_price_projection", statement)


def projection_offsets():
    statement = "SELECT COALESCE(jsonb_object_agg(topic,next_offset),'{}'::jsonb)::text FROM context_input_offsets;"
    return query(PROJECTION, "inventory-price-projection-db", "inventory_price_projection",
                 "inventory_price_projection", statement)


def signature(rows):
    return sorted(json.dumps({"key": row["key"], "soft_deleted": row["soft_deleted"]},
                             sort_keys=True, separators=(",", ":")) for row in rows)


def scalar_text(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (dict, list)):
        return json.dumps(value, sort_keys=True, separators=(",", ":"))
    return str(value)


def attributes_match(table, source, target):
    source_by_key = {json.dumps(row["key"]): row["attributes"] for row in source}
    target_by_key = {json.dumps(row["key"]): row["payload"] for row in target}
    if source_by_key.keys() != target_by_key.keys():
        return False
    return all(all(expected[field] == scalar_text(target_by_key[key].get(field))
                   for field in ATTRIBUTES[table]) for key, expected in source_by_key.items())


def evaluate(source, target, ends, offsets, connector_running, snapshot_complete, slot):
    matches = {table: signature(source[table]) == signature(target.get(table, [])) for table in TABLES}
    attribute_matches = {table: attributes_match(table, source[table], target.get(table, []))
                         for table in TABLES}
    offset_matches = {table: int(offsets.get(f"{snapshot.PREFIX}.public.{table}", 0)) ==
                      (ends[table] or 0) for table in TABLES}
    checks = {"connector_running": connector_running,
              "initial_snapshot_completed": snapshot_complete,
              "slot_usable": slot in ("reserved", "extended"),
              "all_row_keys_and_soft_delete_state_match": all(matches.values()),
              "all_selected_attributes_match": all(attribute_matches.values()),
              "all_topic_offsets_applied": all(offset_matches.values())}
    return {"status": "PASS_CONTEXT_ONLY" if all(checks.values()) else "BLOCKED_BY_QUALITY",
            "checks": checks,
            "table_counts": {table: {"source": len(source[table]),
                                    "projection": len(target.get(table, [])),
                                    "key_and_delete_match": matches[table],
                                    "selected_attributes_match": attribute_matches[table],
                                    "offset_applied": offset_matches[table]} for table in TABLES}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeout-seconds", type=int, default=0)
    args = parser.parse_args()
    if not snapshot.PROJECT.fullmatch(os.environ.get("COMPOSE_PROJECT_NAME", "")):
        parser.error("requires an isolated inventory/price shadow project")
    if not 0 <= args.timeout_seconds <= 600:
        parser.error("timeout must be 0..600 seconds")
    deadline = time.monotonic() + args.timeout_seconds
    while True:
        running, complete = snapshot.connector_state()
        result = evaluate(source_rows(), projection_rows(), snapshot.topic_ends(),
                          projection_offsets(), running, complete, snapshot.source_slot())
        if result["status"] == "PASS_CONTEXT_ONLY" or time.monotonic() >= deadline:
            print(json.dumps(result, sort_keys=True))
            return 0 if result["status"] == "PASS_CONTEXT_ONLY" else 1
        time.sleep(5)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired) as error:
        raise SystemExit(f"cdc-inventory-price-projection-verifier: {error}") from None
