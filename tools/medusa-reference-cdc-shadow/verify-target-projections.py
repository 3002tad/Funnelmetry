#!/usr/bin/env python3
"""Read-only CDC-11 catalog and inventory/price source-to-sink reconciliation.

Runs on the target operator host against the private Medusa and Pipeline DB
containers, Kafka and Connect. Prints only counts/checks/digests. A one-shot
PASS is not a continuous quality lease or live binding authorization.
"""

import argparse
import concurrent.futures
import hashlib
import importlib.util
import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("stage2_projection_verifier", ROOT / "verify-inventory-price-projection.py")
stage2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage2)


def run(command, stdin=None):
    result = subprocess.run(command, input=stdin, text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError(f"target CDC verification command failed (exit {result.returncode})")
    return result.stdout.strip()


def sql(container, user, db, statement):
    output = run(["docker", "exec", "-i", container, "psql", "-X", "-U", user,
                  "-d", db, "-At", "-v", "ON_ERROR_STOP=1"], statement)
    return json.loads(output)


def source(container, statement):
    return sql(container, "medusa", "medusa", statement)


def pipeline(container, statement):
    return sql(container, "funnelmetry", "funnelmetry_handoff", statement)


def topic_end(container, topic):
    output = run(["docker", "exec", container, "/opt/kafka/bin/kafka-get-offsets.sh",
                  "--bootstrap-server", "kafka:9092", "--topic", topic])
    lines = [line for line in output.splitlines() if line.startswith(topic + ":0:")]
    if len(lines) != 1:
        raise ValueError("missing or partitioned target CDC topic")
    return int(lines[0].rsplit(":", 1)[1])


def connector_running(container, name):
    output = run(["docker", "exec", container, "curl", "-fsS", "--max-time", "10",
                  f"http://127.0.0.1:8083/connectors/{name}/status"])
    value = json.loads(output)
    return value.get("connector", {}).get("state") == "RUNNING" and bool(value.get("tasks")) and all(
        task.get("state") == "RUNNING" for task in value["tasks"])


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=False).encode()).hexdigest()


def stage2_digest(rows, *, source_side):
    canonical = {}
    for table in stage2.TABLES:
        projected = []
        for row in rows.get(table, []):
            original = row["attributes"] if source_side else row["payload"]
            attributes = {}
            for field in stage2.ATTRIBUTES[table]:
                value = original.get(field)
                if table == "price_list" and field in ("starts_at", "ends_at"):
                    value = stage2.timestamp_microseconds(value)
                elif table == "price_list_rule" and field == "value":
                    value = json.loads(value) if isinstance(value, str) else value
                elif not source_side:
                    value = stage2.scalar_text(value)
                attributes[field] = value
            projected.append({"key": row["key"], "soft_deleted": row["soft_deleted"],
                              "attributes": attributes})
        canonical[table] = sorted(projected, key=lambda row: json.dumps(row["key"]))
    return digest(canonical)


CATALOG = {
    "product": ("product_id", "catalog_cdc_products_current",
                ("id", "title", "handle", "status", "collection_id", "updated_at", "deleted")),
    "product_variant": ("variant_id", "catalog_cdc_variants_current",
                        ("id", "product_id", "title", "sku", "manage_inventory",
                         "allow_backorder", "updated_at", "deleted")),
    "product_category": ("category_id", "catalog_cdc_categories_current",
                         ("id", "name", "parent_category_id", "is_active", "is_internal",
                          "updated_at", "deleted")),
    "product_category_product": ("product_id", "catalog_cdc_product_categories_current",
                                 ("product_id", "product_category_id")),
}


def catalog_rows(source_container, pipeline_container, epoch):
    source_rows = {}
    projected_rows = {}
    for table, (target_id, target_table, fields) in CATALOG.items():
        source_parts, target_parts = [], []
        for field in fields:
            if field == "updated_at":
                source_expr = "to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')"
                target_expr = "source_updated_raw"
            elif field == "deleted":
                source_expr, target_expr = "deleted_at IS NOT NULL", "soft_deleted"
            elif table == "product_category_product" and field == "product_category_id":
                source_expr, target_expr = "product_category_id", "category_id"
            elif field == "id":
                source_expr, target_expr = "id", target_id
            else:
                source_expr = target_expr = field
            source_parts.append(f"'{field}',{source_expr}")
            target_parts.append(f"'{field}',{target_expr}")
        source_order = "product_id,product_category_id" if table == "product_category_product" else "id"
        target_order = "product_id,category_id" if table == "product_category_product" else target_id
        source_rows[table] = source(source_container,
            "SELECT COALESCE(json_agg(json_build_object(" + ",".join(source_parts) +
            f") ORDER BY {source_order}),'[]'::json)::text FROM public.{table};")
        projected_rows[table] = pipeline(pipeline_container,
            "SELECT COALESCE(json_agg(json_build_object(" + ",".join(target_parts) +
            f") ORDER BY {target_order}),'[]'::json)::text FROM {target_table} "
            f"WHERE source_id='medusa-reference' AND coverage_epoch_id='{epoch}';")
    return source_rows, projected_rows


def stage2_rows(source_container, pipeline_container, epoch):
    parts = []
    for table in stage2.TABLES:
        key = ",".join(stage2.KEYS.get(table, ("id",)))
        attributes = ",".join(f"'{field}',{field}::text" for field in stage2.ATTRIBUTES[table])
        parts.append(f"'{table}',(SELECT COALESCE(jsonb_agg(jsonb_build_object('key',"
                     f"jsonb_build_array({key}),'soft_deleted',deleted_at IS NOT NULL,"
                     f"'attributes',jsonb_build_object({attributes}))),'[]'::jsonb) "
                     f"FROM public.{table})")
    original = source(source_container, "SELECT jsonb_build_object(" + ",".join(parts) + ")::text;")
    projected = pipeline(pipeline_container,
        "SELECT COALESCE(jsonb_object_agg(table_name,rows),'{}'::jsonb)::text "
        "FROM (SELECT table_name,jsonb_agg(jsonb_build_object('key',row_key,"
        "'soft_deleted',soft_deleted,'payload',payload)) AS rows "
        "FROM inventory_price_cdc_context_current WHERE source_id='medusa-reference' "
        f"AND coverage_epoch_id='{epoch}' GROUP BY table_name) AS grouped;")
    return original, projected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile-dir", type=Path, required=True)
    parser.add_argument("--source-container", required=True)
    parser.add_argument("--pipeline-container", required=True)
    parser.add_argument("--kafka-container", required=True)
    parser.add_argument("--connect-container", required=True)
    args = parser.parse_args()
    if args.source_container != "medusa_reference-postgres-1" or any(
            not re.fullmatch(r"[a-f0-9]{12,64}", value) for value in
            (args.pipeline_container, args.kafka_container, args.connect_container)):
        raise ValueError("explicit CDC-11 container IDs required")
    profiles = {kind: json.loads((args.profile_dir / filename).read_text(encoding="utf-8"))
                for kind, filename in (("catalog", "cdc-catalog-shadow.json"),
                                       ("stage2", "cdc-inventory-price-shadow.json"))}
    catalog = profiles["catalog"]
    stage = profiles["stage2"]
    if catalog.get("status") != "SHADOW_ONLY" or stage.get("status") != "SHADOW_ONLY" or \
            catalog.get("coverage_epoch_id") != "cdc11_catalog_epoch1" or \
            stage.get("coverage_epoch_id") != "cdc11_inventory_price_epoch1" or \
            catalog.get("topic_prefix") != "cdc_shadow_medusa_catalog" or \
            stage.get("topic_prefix") != "cdc_shadow_medusa_inventory_price_v2":
        raise ValueError("target CDC profile/epoch differs")
    source_catalog, target_catalog = catalog_rows(args.source_container, args.pipeline_container,
                                                  catalog["coverage_epoch_id"])
    source_stage, target_stage = stage2_rows(args.source_container, args.pipeline_container,
                                             stage["coverage_epoch_id"])
    topics = [f"{catalog['topic_prefix']}.public.{table}" for table in CATALOG] + [
        f"{stage['topic_prefix']}.public.{table}" for table in stage2.TABLES]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        ends = dict(zip(topics, executor.map(lambda topic: topic_end(args.kafka_container, topic), topics)))
    catalog_offsets = pipeline(args.pipeline_container,
        "SELECT COALESCE(json_object_agg(topic,next_offset),'{}'::json)::text "
        "FROM catalog_cdc_input_offsets WHERE source_id='medusa-reference' "
        "AND coverage_epoch_id='cdc11_catalog_epoch1' AND partition=0;")
    stage_offsets = pipeline(args.pipeline_container,
        "SELECT COALESCE(json_object_agg(topic,next_offset),'{}'::json)::text "
        "FROM inventory_price_cdc_input_offsets WHERE source_id='medusa-reference' "
        "AND coverage_epoch_id='cdc11_inventory_price_epoch1' AND partition=0;")
    flags = pipeline(args.pipeline_container,
        "SELECT json_build_object('catalog',(SELECT snapshot_last_seen FROM catalog_cdc_capture_status "
        "WHERE source_id='medusa-reference' AND coverage_epoch_id='cdc11_catalog_epoch1'),"
        "'stage2',(SELECT snapshot_last_seen FROM inventory_price_cdc_capture_status "
        "WHERE source_id='medusa-reference' AND coverage_epoch_id='cdc11_inventory_price_epoch1'))::text;")
    slots = source(args.source_container,
        "SELECT COALESCE(json_object_agg(slot_name,json_build_object('status',wal_status,"
        "'safe_wal_size',safe_wal_size)),'{}'::json)::text FROM pg_replication_slots "
        "WHERE slot_name IN ('funnelmetry_cdc_catalog_shadow',"
        "'funnelmetry_cdc_inventory_price_shadow_v2');")
    catalog_checks = {
        "connector_running": connector_running(args.connect_container, "medusa-cdc-catalog-shadow-e1"),
        "snapshot_complete": flags["catalog"] is True,
        "slot_usable": slots.get(catalog["slot"], {}).get("status") in ("reserved", "extended"),
        "wal_headroom_ge_256m": int(slots.get(catalog["slot"], {}).get("safe_wal_size") or 0) >= 256 * 1024 * 1024,
        "offsets_caught_up": all(int(catalog_offsets.get(topic, -1)) == ends[topic]
                                 for topic in topics if topic.startswith(catalog["topic_prefix"] + ".")),
        "no_foreign_offset_topics": set(catalog_offsets).issubset(
            {topic for topic in topics if topic.startswith(catalog["topic_prefix"] + ".")}),
        "rows_equal": all(source_catalog[table] == target_catalog[table] for table in CATALOG),
    }
    stage_ends = {table: ends[f"{stage['topic_prefix']}.public.{table}"] for table in stage2.TABLES}
    stage_result = stage2.evaluate(source_stage, target_stage, stage_ends,
        stage_offsets, connector_running(args.connect_container,
                                         "medusa-cdc-inventory-price-shadow-e1"),
        flags["stage2"] is True, slots.get(stage["slot"], {}).get("status"))
    stage_checks = dict(stage_result["checks"])
    stage_checks["wal_headroom_ge_256m"] = int(
        slots.get(stage["slot"], {}).get("safe_wal_size") or 0) >= 256 * 1024 * 1024
    stage_checks["no_foreign_offset_topics"] = set(stage_offsets).issubset(
        {topic for topic in topics if topic.startswith(stage["topic_prefix"] + ".")})
    catalog_ends = {topic: ends[topic] for topic in topics
                    if topic.startswith(catalog["topic_prefix"] + ".")}
    stage_topic_ends = {topic: ends[topic] for topic in topics
                        if topic.startswith(stage["topic_prefix"] + ".")}
    stage_source_digest = stage2_digest(source_stage, source_side=True)
    stage_projection_digest = stage2_digest(target_stage, source_side=False)
    stage_checks["semantic_digest_equal"] = stage_source_digest == stage_projection_digest
    report = {"status": "PASS_SHADOW_POINT_IN_TIME" if all(catalog_checks.values()) and
              all(stage_checks.values()) else "BLOCKED_BY_QUALITY",
              "catalog": {"checks": catalog_checks,
                          "counts": {table: {"source": len(source_catalog[table]),
                                              "projection": len(target_catalog[table])}
                                     for table in CATALOG},
                          "source_digest": digest(source_catalog),
                          "projection_digest": digest(target_catalog),
                          "topic_end_offsets": catalog_ends,
                          "applied_offsets": catalog_offsets,
                          "slot_status": slots.get(catalog["slot"], {}).get("status")},
              "inventory_price": {"checks": stage_checks,
                                  "table_counts": stage_result["table_counts"],
                                  "source_digest": stage_source_digest,
                                  "projection_digest": stage_projection_digest,
                                  "topic_end_offsets": stage_topic_ends,
                                  "applied_offsets": {topic: int(stage_offsets.get(topic, 0))
                                                      for topic in stage_topic_ends},
                                  "slot_status": slots.get(stage["slot"], {}).get("status")},
              "continuous_lease": "NOT_ESTABLISHED",
              "live_binding": "UNCHANGED"}
    print(json.dumps(report, sort_keys=True))
    if report["status"] != "PASS_SHADOW_POINT_IN_TIME":
        raise SystemExit(1)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"cdc-target-projections: {error}") from None
