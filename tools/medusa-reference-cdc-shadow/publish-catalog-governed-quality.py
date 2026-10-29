#!/usr/bin/env python3
"""Publish a short-lived catalog quality lease on an isolated CDC clone.

This is a candidate gate, not a live activation command. The Dashboard binding
remains SHADOW until a separate cutover decision changes it.
"""

import argparse
import importlib.util
import json
import os
import re
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "catalog_governed_verifier", ROOT / "verify-catalog-governed-candidate.py")
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)
old = verifier.old
SOURCE_ID = "medusa-reference"
COMPOSE = old.PROJECTION


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def sample():
    source = old.source()
    target = verifier.projection()
    ends = old.topic_ends()
    running = old.connector_running()
    result = old.evaluate(source, target, ends, running)
    return source, target, result


def execute(statement):
    command = COMPOSE + ["exec", "-T", "catalog-projection-db", "psql",
                         "-X", "-U", "catalog_projection", "-d",
                         "catalog_projection", "-At", "-v", "ON_ERROR_STOP=1"]
    result = subprocess.run(command, input=statement, text=True,
                            capture_output=True, check=False)
    if result.returncode:
        detail = result.stderr.strip().splitlines()
        raise RuntimeError("candidate quality SQL failed: " +
                           (" | ".join(detail[-4:])[:400] if detail else "unknown error"))
    return result.stdout.strip()


def block_quality():
    execute("UPDATE catalog_cdc_quality_lease SET status='BLOCKED_BY_QUALITY', "
            "valid_until=clock_timestamp() WHERE source_id='medusa-reference';")


def publish(result, source, target, ttl_seconds, evidence_ref):
    counts_source = {table: len(source[table]) for table in old.TABLES}
    counts_target = {table: len(target[table]) for table in old.TABLES}
    offsets = result["topic_end_offsets"]
    applied = result["next_input_offsets"]
    # The verifier only accepts fixed topic names and integer offsets.
    if set(offsets) != {f"{old.PREFIX}.public.{table}" for table in old.TABLES} or \
            not all(isinstance(value, int) and value >= 0 for value in offsets.values()) or \
            not all(isinstance(value, int) and value >= 0 for value in applied.values()):
        raise ValueError("catalog topic offsets invalid")
    values = [SOURCE_ID, verifier.EPOCH, "PASS", "true",
              json.dumps(counts_source, sort_keys=True),
              json.dumps(counts_target, sort_keys=True),
              result["source_digest"], result["projection_digest"],
              json.dumps(offsets, sort_keys=True), json.dumps(applied, sort_keys=True),
              source["slot_status"], "true"]
    value_sql = ",".join("true" if value == "true" else literal(value)
                         for value in values)
    expected_offsets = literal(json.dumps(applied, sort_keys=True))
    statement = f"""
BEGIN;
-- The writer locks these rows while advancing offsets; this gate must see
-- the same applied prefix it just reconciled.
SELECT next_offset FROM catalog_cdc_input_offsets
 WHERE source_id={literal(SOURCE_ID)} AND coverage_epoch_id={literal(verifier.EPOCH)}
 FOR UPDATE;
WITH written AS (
INSERT INTO catalog_cdc_quality_lease
 (source_id,coverage_epoch_id,status,snapshot_complete,source_row_counts,
  projection_row_counts,source_digest,projection_digest,topic_end_offsets,
  applied_offsets,slot_status,connector_running,verified_at,valid_until,evidence_ref)
SELECT {value_sql}, clock_timestamp(),
       clock_timestamp() + make_interval(secs => {ttl_seconds}),
       {literal(evidence_ref)}
WHERE (SELECT snapshot_last_seen FROM catalog_cdc_capture_status
       WHERE source_id={literal(SOURCE_ID)} AND coverage_epoch_id={literal(verifier.EPOCH)})
  AND (SELECT COALESCE(jsonb_object_agg(topic,next_offset),'{{}}'::jsonb)
       FROM catalog_cdc_input_offsets WHERE source_id={literal(SOURCE_ID)}
       AND coverage_epoch_id={literal(verifier.EPOCH)} AND partition=0)
      = {expected_offsets}::jsonb
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
SELECT CASE WHEN EXISTS (SELECT 1 FROM written)
 THEN 'PUBLISHED' ELSE 'STALE' END;
COMMIT;
"""
    output = execute(statement)
    if "PUBLISHED" not in output.splitlines():
        block_quality()
        raise RuntimeError("catalog quality evidence became stale before publish")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lease-seconds", type=int, default=45)
    parser.add_argument("--evidence-ref", required=True)
    args = parser.parse_args()
    if not old.PROJECT.fullmatch(os.environ.get("COMPOSE_PROJECT_NAME", "")):
        parser.error("requires isolated catalog clone project")
    if not verifier.EPOCH or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", verifier.EPOCH):
        parser.error("set CATALOG_CDC_COVERAGE_EPOCH")
    if not 5 <= args.lease_seconds <= 120:
        parser.error("lease must be 5..120 seconds")
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}", args.evidence_ref):
        parser.error("evidence ref must be a non-secret identifier")
    _, _, first = sample()
    if first["status"] != "PASS":
        block_quality()
        print(json.dumps({"status": "BLOCKED_BY_QUALITY", "checks": first["checks"]},
                         sort_keys=True))
        return 1
    time.sleep(1)
    source, target, result = sample()
    if result["status"] != "PASS" or \
       result["source_digest"] != first["source_digest"] or \
       result["projection_digest"] != first["projection_digest"] or \
       result["topic_end_offsets"] != first["topic_end_offsets"] or \
       result["next_input_offsets"] != first["next_input_offsets"]:
        block_quality()
        print(json.dumps({"status": "BLOCKED_BY_QUALITY",
                          "reason": "reconciliation_changed_during_observation"},
                         sort_keys=True))
        return 1
    publish(result, source, target, args.lease_seconds, args.evidence_ref)
    print(json.dumps({"status": "PASS", "coverage_epoch_id": verifier.EPOCH,
                      "evidence_ref": args.evidence_ref,
                      "lease_seconds": args.lease_seconds,
                      "counts": result["counts"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, OSError) as error:
        raise SystemExit(f"catalog-governed-quality: {error}") from None
