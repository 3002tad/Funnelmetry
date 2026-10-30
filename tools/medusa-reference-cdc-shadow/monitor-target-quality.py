#!/usr/bin/env python3
"""Refresh bounded CDC-11 shadow quality leases from two stable target samples.

Operator-side service. It changes only candidate quality rows, never source
Medusa data, Dashboard binding, catalog-sync or funnel metadata. A failed
probe blocks existing candidate leases; a stopped monitor lets them expire.
"""

import argparse
import concurrent.futures
import json
import re
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SERVICES = {
    "pipeline": "funnelmetry_vps_live_postgres",
    "mapper": "funnelmetry_cdc_target_shadow_order-mapper-db",
    "kafka": "funnelmetry_vps_live_kafka",
    "connect": "funnelmetry_cdc_target_shadow_connect",
}
SOURCE = "medusa_reference-postgres-1"
SOURCE_ID = "medusa-reference"
CATALOG_EPOCH = "cdc11_catalog_epoch1"
STAGE_EPOCH = "cdc11_inventory_price_epoch1"
ORDER_EPOCH = "cdc11_order_epoch1"
FACT = "cdc_shadow_reference.order_recorded_state.v2"


def run(command, stdin=None):
    result = subprocess.run(command, input=stdin, text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError(f"target quality command failed (exit {result.returncode})")
    return result.stdout.strip()


def container_ids():
    result = {}
    for key, service in SERVICES.items():
        ids = run(["docker", "ps", "-q", "--filter",
                   f"label=com.docker.swarm.service.name={service}"]).splitlines()
        if len(ids) != 1 or not re.fullmatch(r"[a-f0-9]{12,64}", ids[0]):
            raise RuntimeError(f"{key} target service does not have one running container")
        result[key] = ids[0]
    return result


def probe(script, ids, profile_dir):
    command = [sys.executable, str(ROOT / script),
               "--source-container", SOURCE,
               "--pipeline-container", ids["pipeline"],
               "--kafka-container", ids["kafka"],
               "--connect-container", ids["connect"]]
    if script == "verify-target-projections.py":
        command += ["--profile-dir", str(profile_dir)]
    else:
        command += ["--mapper-container", ids["mapper"]]
    result = subprocess.run(command, text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError(f"{script} rejected target CDC quality")
    value = json.loads(result.stdout)
    if value.get("status") != "PASS_SHADOW_POINT_IN_TIME":
        raise RuntimeError(f"{script} did not pass target CDC quality")
    return value


def sample(ids, profile_dir):
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        catalog = executor.submit(probe, "verify-target-projections.py", ids, profile_dir)
        order = executor.submit(probe, "verify-target-order-quality.py", ids, profile_dir)
        return catalog.result(), order.result()


def stable(a, b):
    first_catalog, first_order = a
    second_catalog, second_order = b
    for field in ("catalog", "inventory_price"):
        left, right = first_catalog[field], second_catalog[field]
        if left["source_digest"] != right["source_digest"] or \
                left["projection_digest"] != right["projection_digest"] or \
                left["topic_end_offsets"] != right["topic_end_offsets"] or \
                left["applied_offsets"] != right["applied_offsets"]:
            return False
    return (first_order["source_digest"] == second_order["source_digest"] and
            first_order["mapper_digest"] == second_order["mapper_digest"] and
            first_order["sink_digest"] == second_order["sink_digest"] and
            first_order["fact_offset"] == second_order["fact_offset"] and
            first_order["baseline_digest"] == second_order["baseline_digest"] and
            first_order["mapper_offsets"] == second_order["mapper_offsets"] and
            first_order["topic_end_offsets"] == second_order["topic_end_offsets"])


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def json_literal(value):
    return literal(json.dumps(value, sort_keys=True, separators=(",", ":"))) + "::jsonb"


def counts(value, kind):
    if kind == "catalog":
        return ({table: row["source"] for table, row in value["counts"].items()},
                {table: row["projection"] for table, row in value["counts"].items()})
    return ({table: row["source"] for table, row in value["table_counts"].items()},
            {table: row["projection"] for table, row in value["table_counts"].items()})


def upsert_lease(table, epoch, value, kind, seconds):
    source_counts, projection_counts = counts(value, kind)
    fields = ["source_id", "coverage_epoch_id", "status", "snapshot_complete",
              "source_row_counts", "projection_row_counts", "source_digest",
              "projection_digest", "topic_end_offsets", "applied_offsets",
              "slot_status", "connector_running", "verified_at", "valid_until",
              "evidence_ref"]
    values = [literal(SOURCE_ID), literal(epoch), "'PASS'", "true",
              json_literal(source_counts), json_literal(projection_counts),
              literal(value["source_digest"]), literal(value["projection_digest"]),
              json_literal(value["topic_end_offsets"]), json_literal(value["applied_offsets"]),
              literal(value["slot_status"]), "true", "clock_timestamp()",
              f"clock_timestamp()+make_interval(secs=>{seconds})",
              "'cdc11-target-shadow-two-sample'"]
    updates = ",".join(f"{field}=EXCLUDED.{field}" for field in fields[1:])
    return (f"INSERT INTO {table}({','.join(fields)}) VALUES({','.join(values)}) "
            f"ON CONFLICT(source_id) DO UPDATE SET {updates};")


def write_pass(ids, catalog, order, seconds):
    catalog_value, stage_value = catalog["catalog"], catalog["inventory_price"]
    catalog_offsets = json_literal(catalog_value["applied_offsets"])
    stage_nonzero = {topic: offset for topic, offset in stage_value["applied_offsets"].items()
                     if offset > 0}
    stage_offsets = json_literal(stage_nonzero)
    statement = f"""BEGIN;
      SELECT next_offset FROM reference_cdc_v2_sink_offsets
        WHERE fact_topic={literal(FACT)} AND partition=0 FOR UPDATE;
      SELECT next_offset FROM catalog_cdc_input_offsets
        WHERE source_id={literal(SOURCE_ID)} AND coverage_epoch_id={literal(CATALOG_EPOCH)}
        FOR SHARE;
      SELECT next_offset FROM inventory_price_cdc_input_offsets
        WHERE source_id={literal(SOURCE_ID)} AND coverage_epoch_id={literal(STAGE_EPOCH)}
        FOR SHARE;
      DO $$ BEGIN
        IF (SELECT COALESCE(jsonb_object_agg(topic,next_offset),'{{}}'::jsonb)
            FROM catalog_cdc_input_offsets WHERE source_id={literal(SOURCE_ID)}
            AND coverage_epoch_id={literal(CATALOG_EPOCH)} AND partition=0) <> {catalog_offsets}
          OR (SELECT COALESCE(jsonb_object_agg(topic,next_offset),'{{}}'::jsonb)
            FROM inventory_price_cdc_input_offsets WHERE source_id={literal(SOURCE_ID)}
            AND coverage_epoch_id={literal(STAGE_EPOCH)} AND partition=0) <> {stage_offsets}
          OR (SELECT next_offset FROM reference_cdc_v2_sink_offsets
            WHERE fact_topic={literal(FACT)} AND partition=0) <> {int(order['fact_offset'])}
        THEN RAISE EXCEPTION 'CDC shadow offsets changed after quality sample'; END IF;
      END $$;
      {upsert_lease('catalog_cdc_quality_lease', CATALOG_EPOCH, catalog_value, 'catalog', seconds)}
      {upsert_lease('inventory_price_cdc_quality_lease', STAGE_EPOCH, stage_value, 'stage2', seconds)}
      UPDATE reference_cdc_v2_quality_state SET status='CURRENT_STATE_READY',
        reason='TARGET_SOURCE_MAPPER_SINK_RECONCILED',
        verified_at=clock_timestamp(),
        valid_until=clock_timestamp()+make_interval(secs=>{seconds})
        WHERE source_instance_id={literal(SOURCE_ID)}
          AND coverage_epoch_id={literal(ORDER_EPOCH)}
          AND baseline_complete AND baseline_digest={literal(order['baseline_digest'])};
      DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM reference_cdc_v2_quality_state
        WHERE source_instance_id={literal(SOURCE_ID)}
          AND coverage_epoch_id={literal(ORDER_EPOCH)}
          AND status='CURRENT_STATE_READY' AND valid_until>clock_timestamp())
        THEN RAISE EXCEPTION 'order quality row not updated'; END IF; END $$;
      COMMIT;"""
    output = run(["docker", "exec", "-i", ids["pipeline"], "psql", "-X", "-U",
                  "funnelmetry", "-d", "funnelmetry_handoff", "-At",
                  "-v", "ON_ERROR_STOP=1"], statement)
    if "COMMIT" not in output:
        raise RuntimeError("quality lease transaction did not commit")


def write_blocked(ids):
    statement = """BEGIN;
      UPDATE catalog_cdc_quality_lease SET status='BLOCKED_BY_QUALITY',
        valid_until=clock_timestamp() WHERE source_id='medusa-reference';
      UPDATE inventory_price_cdc_quality_lease SET status='BLOCKED_BY_QUALITY',
        valid_until=clock_timestamp() WHERE source_id='medusa-reference';
      UPDATE reference_cdc_v2_quality_state SET status='BLOCKED_BY_QUALITY',
        reason='TARGET_RECONCILIATION_FAILED',valid_until=clock_timestamp()
        WHERE source_instance_id='medusa-reference' AND coverage_epoch_id='cdc11_order_epoch1';
      COMMIT;"""
    run(["docker", "exec", "-i", ids["pipeline"], "psql", "-X", "-U", "funnelmetry",
         "-d", "funnelmetry_handoff", "-At", "-v", "ON_ERROR_STOP=1"], statement)


def cycle(profile_dir, seconds, write):
    ids = container_ids()
    try:
        first = sample(ids, profile_dir)
        time.sleep(1)
        second = sample(ids, profile_dir)
        if not stable(first, second):
            raise RuntimeError("target CDC source/offset changed between samples")
        if write:
            write_pass(ids, second[0], second[1], seconds)
        print(json.dumps({"status": "PASS_SHADOW_LEASE" if write else "PASS_SHADOW_DRY_RUN",
                          "catalog_products": second[0]["catalog"]["counts"]["product"]["source"],
                          "stage2_tables": len(second[0]["inventory_price"]["table_counts"]),
                          "order_count": second[1]["source_count"],
                          "fact_offset": second[1]["fact_offset"],
                          "lease_seconds": seconds if write else 0}, sort_keys=True), flush=True)
        return True
    except (RuntimeError, ValueError, KeyError, TypeError, OSError, json.JSONDecodeError) as error:
        if write:
            try:
                write_blocked(ids)
            except (RuntimeError, OSError):
                pass  # bounded prior lease expires if the Pipeline DB is unavailable
        print(json.dumps({"status": "BLOCKED_BY_QUALITY", "reason": str(error)[:120]}),
              flush=True)
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile-dir", type=Path, required=True)
    parser.add_argument("--lease-seconds", type=int, default=240)
    parser.add_argument("--interval-seconds", type=int, default=60)
    parser.add_argument("--write-shadow-lease", action="store_true")
    parser.add_argument("--loop", action="store_true")
    args = parser.parse_args()
    if not 90 <= args.lease_seconds <= 600 or not 15 <= args.interval_seconds <= 300:
        raise ValueError("shadow lease/interval outside bounded range")
    if not args.profile_dir.is_dir():
        raise ValueError("target profile directory missing")
    while True:
        passed = cycle(args.profile_dir, args.lease_seconds, args.write_shadow_lease)
        if not args.loop:
            return 0 if passed else 1
        time.sleep(args.interval_seconds)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, RuntimeError, OSError) as error:
        raise SystemExit(f"cdc-target-quality-monitor: {error}") from None
