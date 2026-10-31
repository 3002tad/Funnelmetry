#!/usr/bin/env python3
"""Reconcile the four-table CDC catalog projection against an isolated source clone.

Reads only approved catalog columns and prints counts/digests, never product
payloads. The comparison is a point-in-time gate, not a live Dashboard cutover.
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
BASE = ["docker", "compose", "-f", str(ROOT / "compose.yml")]
PROJECTION = BASE + ["-f", str(ROOT / "compose.catalog-projection.yml")]
PROJECT = re.compile(r"(?:funnelmetry_cdc_catalog_shadow_|"
                     r"funnelmetry_cdc_combined_shadow_)[a-z0-9][a-z0-9_-]{0,32}\Z")
PREFIX = "cdc_shadow_medusa_catalog"
TABLES = ("product", "product_variant", "product_category", "product_category_product")


def run(command, stdin=None):
    result = subprocess.run(command, input=stdin, text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError(f"shadow verification command failed: {command[0]} {command[1]}")
    return result.stdout.strip()


def sql(compose, service, user, db, statement):
    output = run(compose + ["exec", "-T", service, "psql", "-X", "-U", user,
                            "-d", db, "-At", "-v", "ON_ERROR_STOP=1"], statement)
    rows = [line for line in output.splitlines() if line.startswith("{")]
    if len(rows) != 1:
        raise RuntimeError("unexpected shadow reconciliation query shape")
    return json.loads(rows[0])


def source():
    return sql(BASE, "postgres", "medusa", "medusa", '''
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT json_build_object(
 'product', (SELECT COALESCE(json_agg(json_build_object('id',id,'title',title,
   'handle',handle,'status',status,'collection_id',collection_id,
   'updated_at',to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'deleted',deleted_at IS NOT NULL) ORDER BY id),'[]'::json) FROM product),
 'product_variant', (SELECT COALESCE(json_agg(json_build_object('id',id,
   'product_id',product_id,'title',title,'sku',sku,
   'manage_inventory',manage_inventory,'allow_backorder',allow_backorder,
   'updated_at',to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'deleted',deleted_at IS NOT NULL) ORDER BY id),'[]'::json) FROM product_variant),
 'product_category', (SELECT COALESCE(json_agg(json_build_object('id',id,
   'name',name,'parent_category_id',parent_category_id,
   'is_active',is_active,'is_internal',is_internal,
   'updated_at',to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'deleted',deleted_at IS NOT NULL) ORDER BY id),'[]'::json) FROM product_category),
 'product_category_product', (SELECT COALESCE(json_agg(json_build_object(
   'product_id',product_id,'product_category_id',product_category_id)
   ORDER BY product_id,product_category_id),'[]'::json) FROM product_category_product),
 'slot_status', (SELECT wal_status FROM pg_replication_slots
   WHERE slot_name='funnelmetry_cdc_catalog_shadow'))::text;
COMMIT;
''')


def projection():
    return sql(PROJECTION, "catalog-projection-db", "catalog_projection",
               "catalog_projection", '''
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT json_build_object(
 'product', (SELECT COALESCE(json_agg(json_build_object('id',product_id,
   'title',title,'handle',handle,'status',status,'collection_id',collection_id,
   'updated_at',source_updated_raw,
   'deleted',soft_deleted) ORDER BY product_id),'[]'::json) FROM catalog_products_current),
 'product_variant', (SELECT COALESCE(json_agg(json_build_object('id',variant_id,
   'product_id',product_id,'title',title,'sku',sku,
   'manage_inventory',manage_inventory,'allow_backorder',allow_backorder,
   'updated_at',source_updated_raw,
   'deleted',soft_deleted) ORDER BY variant_id),'[]'::json) FROM catalog_variants_current),
 'product_category', (SELECT COALESCE(json_agg(json_build_object('id',category_id,
   'name',name,'parent_category_id',parent_category_id,
   'is_active',is_active,'is_internal',is_internal,
   'updated_at',source_updated_raw,
   'deleted',soft_deleted) ORDER BY category_id),'[]'::json) FROM catalog_categories_current),
 'product_category_product', (SELECT COALESCE(json_agg(json_build_object(
   'product_id',product_id,'product_category_id',category_id)
   ORDER BY product_id,category_id),'[]'::json) FROM catalog_product_categories_current),
 'snapshot_complete', (SELECT snapshot_last_seen FROM catalog_capture_status
   WHERE source_id='medusa-reference'),
 'input_offsets', (SELECT COALESCE(json_object_agg(topic,next_offset),'{}'::json)
   FROM catalog_input_offsets WHERE partition=0),
 'audit_count', (SELECT count(*) FROM catalog_cdc_audit),
 'orphan_variants', (SELECT count(*) FROM catalog_variants_current v
   LEFT JOIN catalog_products_current p ON p.source_id=v.source_id AND p.product_id=v.product_id
   WHERE p.product_id IS NULL),
 'orphan_category_links', (SELECT count(*) FROM catalog_product_categories_current pc
   LEFT JOIN catalog_products_current p ON p.source_id=pc.source_id AND p.product_id=pc.product_id
   LEFT JOIN catalog_categories_current c ON c.source_id=pc.source_id AND c.category_id=pc.category_id
   WHERE p.product_id IS NULL OR c.category_id IS NULL))::text;
COMMIT;
''')


def topic_ends():
    values = {}
    for table in TABLES:
        topic = f"{PREFIX}.public.{table}"
        output = run(BASE + ["exec", "-T", "kafka", "/opt/kafka/bin/kafka-get-offsets.sh",
                             "--bootstrap-server", "kafka:9092", "--topic", topic])
        lines = [line for line in output.splitlines() if line.startswith(topic + ":0:")]
        if len(lines) != 1:
            raise RuntimeError("missing or partitioned catalog topic")
        values[topic] = int(lines[0].rsplit(":", 1)[1])
    return values


def connector_running():
    output = run(BASE + ["exec", "-T", "connect", "curl", "-fsS", "--max-time", "10",
                         "http://127.0.0.1:8083/connectors/medusa-cdc-catalog-shadow/status"])
    status = json.loads(output)
    return status.get("connector", {}).get("state") == "RUNNING" and bool(status.get("tasks")) and all(
        task.get("state") == "RUNNING" for task in status["tasks"])


def checksum(rows):
    canonical = json.dumps(rows, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode()).hexdigest()


def evaluate(source_state, target, ends, running):
    matches = {table: source_state[table] == target[table] for table in TABLES}
    counts = {table: {"source": len(source_state[table]), "projection": len(target[table])}
              for table in TABLES}
    offsets = target["input_offsets"]
    offset_ok = all(int(offsets.get(topic, -1)) == end for topic, end in ends.items())
    checks = {"source_slot_usable": source_state["slot_status"] in ("reserved", "extended"),
              "connector_running": running, "snapshot_complete": target["snapshot_complete"] is True,
              "all_topic_offsets_caught_up": offset_ok,
              "no_orphan_variants": target["orphan_variants"] == 0,
              "no_orphan_category_links": target["orphan_category_links"] == 0,
              **{f"{table}_reconciled": same for table, same in matches.items()}}
    return {"status": "PASS" if all(checks.values()) else "BLOCKED_BY_QUALITY",
            "checks": checks, "counts": counts,
            "source_digest": checksum({table: source_state[table] for table in TABLES}),
            "projection_digest": checksum({table: target[table] for table in TABLES}),
            "audit_count": target["audit_count"], "topic_end_offsets": ends,
            "next_input_offsets": offsets}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeout-seconds", type=int, default=0)
    args = parser.parse_args()
    if not PROJECT.fullmatch(os.environ.get("COMPOSE_PROJECT_NAME", "")):
        parser.error("requires an isolated funnelmetry_cdc_catalog_shadow_* project")
    if not 0 <= args.timeout_seconds <= 600:
        parser.error("timeout must be 0..600 seconds")
    deadline = time.monotonic() + args.timeout_seconds
    while True:
        result = evaluate(source(), projection(), topic_ends(), connector_running())
        if result["status"] == "PASS" or time.monotonic() >= deadline:
            print(json.dumps(result, sort_keys=True))
            return 0 if result["status"] == "PASS" else 1
        time.sleep(5)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired) as error:
        raise SystemExit(f"cdc-catalog-shadow-verifier: {error}") from None
