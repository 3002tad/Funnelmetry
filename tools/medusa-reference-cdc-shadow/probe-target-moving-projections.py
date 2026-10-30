#!/usr/bin/env python3
"""Read-only moving-quality probe for target catalog and inventory/price CDC.

This is a candidate diagnostic. Pending age is retained only within this
process; it cannot publish a quality lease or authorize a live binding.
"""

import argparse
import importlib.util
import json
import re
import time
from pathlib import Path

from moving_projection_quality import evaluate
from target_kafka_offsets import read_topic_ends


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "target_projection_verifier", ROOT / "verify-target-projections.py")
target = importlib.util.module_from_spec(spec)
spec.loader.exec_module(target)


def catalog_canonical(rows):
    result = {}
    for table in target.CATALOG:
        result[table] = []
        for row in rows[table]:
            key = ([row["product_id"], row["product_category_id"]]
                   if table == "product_category_product" else row["id"])
            result[table].append({"key": key, "value": row})
    return result


def stage_canonical(rows, *, source_side):
    result = {}
    for table in target.stage2.TABLES:
        result[table] = []
        for row in rows.get(table, []):
            original = row["attributes"] if source_side else row["payload"]
            attributes = {}
            for field in target.stage2.ATTRIBUTES[table]:
                value = original.get(field)
                if table == "price_list" and field in ("starts_at", "ends_at"):
                    value = target.stage2.timestamp_microseconds(value)
                elif table == "price_list_rule" and field == "value":
                    value = json.loads(value) if isinstance(value, str) else value
                elif not source_side:
                    value = target.stage2.scalar_text(value)
                attributes[field] = value
            result[table].append({"key": row["key"],
                                  "value": {"soft_deleted": row["soft_deleted"],
                                            "attributes": attributes}})
    return result


def profiles(directory):
    result = {}
    for name, filename, epoch, prefix, slot in (
            ("catalog", "cdc-catalog-shadow.json", "cdc11_catalog_epoch1",
             "cdc_shadow_medusa_catalog", "funnelmetry_cdc_catalog_shadow"),
            ("stage", "cdc-inventory-price-shadow.json",
             "cdc11_inventory_price_epoch1", "cdc_shadow_medusa_inventory_price_v2",
             "funnelmetry_cdc_inventory_price_shadow_v2")):
        value = json.loads((directory / filename).read_text(encoding="utf-8"))
        if (value.get("status") != "SHADOW_ONLY" or
                value.get("coverage_epoch_id") != epoch or
                value.get("topic_prefix") != prefix or value.get("slot") != slot):
            raise ValueError(f"{name} target CDC profile differs")
        result[name] = value
    return result


def sample(args, current_profiles, first_seen):
    catalog = current_profiles["catalog"]
    stage = current_profiles["stage"]
    source_catalog, projection_catalog = target.catalog_rows(
        args.source_container, args.pipeline_container, catalog["coverage_epoch_id"],
        projection_first=True)
    source_stage, projection_stage = target.stage2_rows(
        args.source_container, args.pipeline_container, stage["coverage_epoch_id"],
        projection_first=True)
    topic_groups = {
        "catalog": {f"{catalog['topic_prefix']}.public.{table}"
                    for table in target.CATALOG},
        "stage": {f"{stage['topic_prefix']}.public.{table}"
                  for table in target.stage2.TABLES},
    }
    ends = read_topic_ends(args.kafka_container, sorted(
        topic_groups["catalog"] | topic_groups["stage"]))
    offsets = {}
    for name, table in (("catalog", "catalog_cdc_input_offsets"),
                        ("stage", "inventory_price_cdc_input_offsets")):
        epoch = current_profiles[name]["coverage_epoch_id"]
        offsets[name] = target.pipeline(args.pipeline_container,
            "SELECT COALESCE(json_object_agg(topic,next_offset),'{}'::json)::text "
            f"FROM {table} WHERE source_id='medusa-reference' "
            f"AND coverage_epoch_id='{epoch}' AND partition=0;")
    flags = target.pipeline(args.pipeline_container,
        "SELECT json_build_object('catalog',(SELECT snapshot_last_seen FROM "
        "catalog_cdc_capture_status WHERE source_id='medusa-reference' "
        "AND coverage_epoch_id='cdc11_catalog_epoch1'),"
        "'stage',(SELECT snapshot_last_seen FROM inventory_price_cdc_capture_status "
        "WHERE source_id='medusa-reference' "
        "AND coverage_epoch_id='cdc11_inventory_price_epoch1'))::text;")
    slots = target.source(args.source_container,
        "SELECT COALESCE(json_object_agg(slot_name,json_build_object('status',wal_status,"
        "'safe_wal_size',safe_wal_size)),'{}'::json)::text FROM pg_replication_slots "
        "WHERE slot_name IN ('funnelmetry_cdc_catalog_shadow',"
        "'funnelmetry_cdc_inventory_price_shadow_v2');")
    row_groups = {
        "catalog": (catalog_canonical(source_catalog),
                    catalog_canonical(projection_catalog)),
        "stage": (stage_canonical(source_stage, source_side=True),
                  stage_canonical(projection_stage, source_side=False)),
    }
    observed_at = time.monotonic()
    result = {}
    for name, connector in (("catalog", "medusa-cdc-catalog-shadow-e1"),
                            ("stage", "medusa-cdc-inventory-price-shadow-e1")):
        profile = current_profiles[name]
        expected = topic_groups[name]
        actual = offsets[name]
        # A never-seen, empty topic has an implicit zero processing prefix.
        # Any foreign topic is retained so the evaluator can reject it.
        applied = {topic: int(actual.get(topic, 0)) for topic in expected}
        applied.update({topic: int(value) for topic, value in actual.items()
                        if topic not in expected})
        slot = slots.get(profile["slot"], {})
        safe_wal = slot.get("safe_wal_size")
        source_rows, projection_rows = row_groups[name]
        result[name] = evaluate(source_rows, projection_rows,
            expected_topics=expected,
            topic_ends={topic: ends[topic] for topic in expected},
            applied_offsets=applied,
            connector_running=target.connector_running(args.connect_container, connector),
            snapshot_complete=flags[name], slot_status=slot.get("status"),
            safe_wal_bytes=int(safe_wal) if safe_wal is not None else None,
            minimum_safe_wal_bytes=256 * 1024 * 1024,
            max_pending_rows=args.max_pending_rows,
            max_offset_lag=args.max_offset_lag,
            max_pending_seconds=args.max_pending_seconds,
            first_seen=first_seen[name], now_seconds=observed_at)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("source-container", "pipeline-container", "kafka-container",
                 "connect-container"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--profile-dir", type=Path, required=True)
    parser.add_argument("--max-pending-rows", type=int, required=True)
    parser.add_argument("--max-offset-lag", type=int, required=True)
    parser.add_argument("--max-pending-seconds", type=float, required=True)
    parser.add_argument("--iterations", type=int, default=1)
    parser.add_argument("--interval-seconds", type=float, default=1)
    args = parser.parse_args()
    if (args.source_container != "medusa_reference-postgres-1" or any(
            not re.fullmatch(r"[a-f0-9]{12,64}", getattr(args, name)) for name in
            ("pipeline_container", "kafka_container", "connect_container")) or
            not args.profile_dir.is_dir() or
            not 0 <= args.max_pending_rows <= 50 or
            not 0 <= args.max_offset_lag <= 256 or
            not 0 < args.max_pending_seconds <= 120 or
            not 1 <= args.iterations <= 20 or
            not 0 <= args.interval_seconds <= 10):
        parser.error("invalid target containers or candidate bounds")
    current_profiles = profiles(args.profile_dir)
    first_seen = {"catalog": {}, "stage": {}}
    failed = False
    for iteration in range(args.iterations):
        result = sample(args, current_profiles, first_seen)
        first_seen = {name: value["pending_first_seen"] for name, value in result.items()}
        failed |= any(value["status"] != "PASS_BOUNDED_LAG" for value in result.values())
        print(json.dumps({"iteration": iteration + 1, "status":
              "PASS_BOUNDED_LAG" if all(value["status"] == "PASS_BOUNDED_LAG"
                                         for value in result.values()) else "BLOCKED_BY_QUALITY",
              "streams": {name: {"status": value["status"], "checks": value["checks"],
                                 "pending_row_count": value["pending_row_count"],
                                 "offset_backlog": value["offset_backlog"]}
                          for name, value in result.items()}}, sort_keys=True), flush=True)
        if iteration + 1 < args.iterations:
            time.sleep(args.interval_seconds)
    return 1 if failed else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, OSError, TypeError, KeyError,
            json.JSONDecodeError) as error:
        raise SystemExit(f"cdc-target-moving-projections: {error}") from None
