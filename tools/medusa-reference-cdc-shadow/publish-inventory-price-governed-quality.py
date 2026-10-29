#!/usr/bin/env python3
"""Publish a short-lived CONTEXT_ONLY quality lease on an isolated CDC clone.

This never binds an inventory availability or storefront price analytical asset.
It certifies source row/offset equality at an observed checkpoint only.
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
spec = importlib.util.spec_from_file_location(
    "inventory_price_governed_verifier", ROOT / "verify-inventory-price-governed-candidate.py")
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)
stage2 = verifier.stage2
snapshot = verifier.snapshot
SOURCE_ID = "medusa-reference"
COMPOSE = verifier.COMPOSE


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def normalized_value(table, field, value, source):
    if table == "price_list" and field in ("starts_at", "ends_at"):
        return stage2.timestamp_microseconds(value)
    if table == "price_list_rule" and field == "value":
        return None if value is None else json.loads(value) if isinstance(value, str) else value
    return value if source else stage2.scalar_text(value)


def digest(rows, source):
    canonical = {}
    for table in stage2.TABLES:
        items = []
        for row in rows.get(table, []):
            data = row["attributes"] if source else row["payload"]
            items.append({"key": row["key"], "soft_deleted": row["soft_deleted"],
                          "attributes": {field: normalized_value(table, field, data[field], source)
                                         for field in stage2.ATTRIBUTES[table]}})
        canonical[table] = sorted(items, key=lambda item: json.dumps(item["key"]))
    raw = json.dumps(canonical, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(raw.encode()).hexdigest()


def sample():
    source = stage2.source_rows()
    target = verifier.candidate_rows()
    ends = snapshot.topic_ends()
    offsets = verifier.candidate_offsets()
    running, complete = snapshot.connector_state()
    slot = snapshot.source_slot()
    result = stage2.evaluate(source, target, ends, offsets, running, complete, slot)
    topic_ends = {f"{snapshot.PREFIX}.public.{table}": int(ends[table] or 0)
                  for table in stage2.TABLES}
    applied = {topic: int(value) for topic, value in offsets.items()}
    return {"source": source, "target": target, "result": result,
            "source_digest": digest(source, True), "projection_digest": digest(target, False),
            "ends": topic_ends, "applied": applied, "slot": slot}


def execute(statement):
    command = COMPOSE + ["exec", "-T", "inventory-price-projection-db", "psql",
                         "-X", "-U", "inventory_price_projection", "-d",
                         "inventory_price_projection", "-At", "-v", "ON_ERROR_STOP=1"]
    result = subprocess.run(command, input=statement, text=True,
                            capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError("candidate context quality SQL failed")
    return result.stdout.strip()


def block_quality():
    execute("UPDATE inventory_price_cdc_quality_lease "
            "SET status='BLOCKED_BY_QUALITY',valid_until=clock_timestamp() "
            "WHERE source_id='medusa-reference';")


def publish(observation, ttl_seconds, evidence_ref):
    epoch = os.environ["CDC_COVERAGE_EPOCH"]
    source_counts = {table: len(observation["source"][table]) for table in stage2.TABLES}
    target_counts = {table: len(observation["target"].get(table, [])) for table in stage2.TABLES}
    expected_topics = {f"{snapshot.PREFIX}.public.{table}" for table in stage2.TABLES}
    if set(observation["ends"]) != expected_topics or \
            set(observation["applied"]) != expected_topics or \
            any(value < 0 for value in observation["ends"].values()) or \
            any(value < 0 for value in observation["applied"].values()):
        raise ValueError("stage-2 topic offsets are incomplete")
    values = [SOURCE_ID, epoch, "PASS", "true", json.dumps(source_counts, sort_keys=True),
              json.dumps(target_counts, sort_keys=True), observation["source_digest"],
              observation["projection_digest"], json.dumps(observation["ends"], sort_keys=True),
              json.dumps(observation["applied"], sort_keys=True), observation["slot"], "true"]
    value_sql = ",".join("true" if value == "true" else literal(value) for value in values)
    expected_offsets = literal(json.dumps(observation["applied"], sort_keys=True))
    statement = f"""
BEGIN;
SELECT next_offset FROM inventory_price_cdc_input_offsets
 WHERE source_id={literal(SOURCE_ID)} AND coverage_epoch_id={literal(epoch)} FOR UPDATE;
WITH written AS (
INSERT INTO inventory_price_cdc_quality_lease
 (source_id,coverage_epoch_id,status,snapshot_complete,source_row_counts,
  projection_row_counts,source_digest,projection_digest,topic_end_offsets,
  applied_offsets,slot_status,connector_running,verified_at,valid_until,evidence_ref)
SELECT {value_sql}, clock_timestamp(),
       clock_timestamp() + make_interval(secs => {ttl_seconds}),
       {literal(evidence_ref)}
WHERE (SELECT snapshot_last_seen FROM inventory_price_cdc_capture_status
       WHERE source_id={literal(SOURCE_ID)} AND coverage_epoch_id={literal(epoch)})
  AND (SELECT COALESCE(jsonb_object_agg(topic,next_offset),'{{}}'::jsonb)
       FROM inventory_price_cdc_input_offsets WHERE source_id={literal(SOURCE_ID)}
       AND coverage_epoch_id={literal(epoch)} AND partition=0) = {expected_offsets}::jsonb
ON CONFLICT (source_id) DO UPDATE SET
 coverage_epoch_id=EXCLUDED.coverage_epoch_id,status=EXCLUDED.status,
 snapshot_complete=EXCLUDED.snapshot_complete,
 source_row_counts=EXCLUDED.source_row_counts,
 projection_row_counts=EXCLUDED.projection_row_counts,
 source_digest=EXCLUDED.source_digest,
 projection_digest=EXCLUDED.projection_digest,
 topic_end_offsets=EXCLUDED.topic_end_offsets,
 applied_offsets=EXCLUDED.applied_offsets,
 slot_status=EXCLUDED.slot_status,
 connector_running=EXCLUDED.connector_running,
 verified_at=EXCLUDED.verified_at,valid_until=EXCLUDED.valid_until,
 evidence_ref=EXCLUDED.evidence_ref
RETURNING source_id)
SELECT CASE WHEN EXISTS (SELECT 1 FROM written) THEN 'PUBLISHED' ELSE 'STALE' END;
COMMIT;
"""
    if "PUBLISHED" not in execute(statement).splitlines():
        block_quality()
        raise RuntimeError("context quality evidence became stale before publish")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lease-seconds", type=int, default=45)
    parser.add_argument("--evidence-ref", required=True)
    args = parser.parse_args()
    epoch = os.environ.get("CDC_COVERAGE_EPOCH", "")
    if os.environ.get("COMPOSE_PROJECT_NAME") != "funnelmetry_cdc_inventory_price_shadow_stage2b" or \
            epoch != "inventory-price-shadow-20261029-b":
        parser.error("requires exact isolated stage2b clone and epoch")
    if not 5 <= args.lease_seconds <= 120:
        parser.error("lease must be 5..120 seconds")
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}", args.evidence_ref):
        parser.error("evidence ref must be a non-secret identifier")
    first = sample()
    if first["result"]["status"] != "PASS_CONTEXT_ONLY" or \
            first["source_digest"] != first["projection_digest"]:
        block_quality()
        print(json.dumps({"status":"BLOCKED_BY_QUALITY","checks":first["result"]["checks"]},
                         sort_keys=True))
        return 1
    time.sleep(1)
    second = sample()
    if second["result"]["status"] != "PASS_CONTEXT_ONLY" or \
            any(first[field] != second[field] for field in
                ("source_digest", "projection_digest", "ends", "applied")) or \
            second["source_digest"] != second["projection_digest"]:
        block_quality()
        print(json.dumps({"status":"BLOCKED_BY_QUALITY",
                          "reason":"reconciliation_changed_during_observation"}, sort_keys=True))
        return 1
    publish(second, args.lease_seconds, args.evidence_ref)
    print(json.dumps({"status":"PASS_CONTEXT_ONLY", "coverage_epoch_id":epoch,
                      "evidence_ref":args.evidence_ref, "lease_seconds":args.lease_seconds,
                      "digest":second["source_digest"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, OSError) as error:
        raise SystemExit(f"inventory-price-governed-quality: {error}") from None
