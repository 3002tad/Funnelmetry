#!/usr/bin/env python3
"""Reconcile the versioned Pipeline stage-2 context candidate on a private clone."""

import argparse
import importlib.util
import json
import os
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("stage2_verifier", ROOT / "verify-inventory-price-projection.py")
stage2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage2)
snapshot = stage2.snapshot
COMPOSE = stage2.PROJECTION + ["-f", str(ROOT / "compose.inventory-price-governed-candidate.yml")]


def candidate_rows():
    epoch = os.environ.get("CDC_COVERAGE_EPOCH", "")
    if not epoch or not all(char.isalnum() or char in "_-" for char in epoch):
        raise ValueError("set CDC_COVERAGE_EPOCH")
    statement = ("SELECT COALESCE(jsonb_object_agg(table_name,rows),'{}'::jsonb)::text "
                 "FROM (SELECT table_name,jsonb_agg(jsonb_build_object('key',row_key,"
                 "'soft_deleted',soft_deleted,'payload',payload)) AS rows "
                 "FROM inventory_price_cdc_context_current "
                 f"WHERE coverage_epoch_id='{epoch}' AND source_id='medusa-reference' "
                 "GROUP BY table_name) AS grouped;")
    return stage2.query(COMPOSE, "inventory-price-projection-db", "inventory_price_projection",
                        "inventory_price_projection", statement)


def candidate_offsets():
    epoch = os.environ.get("CDC_COVERAGE_EPOCH", "")
    statement = ("SELECT COALESCE(jsonb_object_agg(topic,next_offset),'{}'::jsonb)::text "
                 "FROM inventory_price_cdc_input_offsets WHERE source_id='medusa-reference' "
                 f"AND coverage_epoch_id='{epoch}' AND partition=0;")
    return stage2.query(COMPOSE, "inventory-price-projection-db", "inventory_price_projection",
                        "inventory_price_projection", statement)


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
        result = stage2.evaluate(stage2.source_rows(), candidate_rows(), snapshot.topic_ends(),
                                 candidate_offsets(), running, complete, snapshot.source_slot())
        if result["status"] == "PASS_CONTEXT_ONLY" or time.monotonic() >= deadline:
            print(json.dumps(result, sort_keys=True))
            return 0 if result["status"] == "PASS_CONTEXT_ONLY" else 1
        time.sleep(5)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, OSError) as error:
        raise SystemExit(f"inventory-price-governed-candidate-verifier: {error}") from None
