#!/usr/bin/env python3
"""Prove new stage-2 CDC input revokes the candidate context quality lease."""

import importlib.util
import json
import os
import re
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "context_probe", ROOT / "probe-inventory-price-governed-candidate.py")
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


def lease():
    output = probe.candidate_sql("SELECT json_build_object('status',status,"
                                 "'fresh',valid_until>clock_timestamp())::text "
                                 "FROM inventory_price_cdc_quality_lease "
                                 "WHERE source_id='medusa-reference';")
    return json.loads(output)


def main():
    if os.environ.get("COMPOSE_PROJECT_NAME") != "funnelmetry_cdc_inventory_price_shadow_stage2b" or \
            os.environ.get("CDC_COVERAGE_EPOCH") != "inventory-price-shadow-20261029-b":
        raise RuntimeError("requires exact isolated stage2b clone and epoch")
    before = lease()
    if before != {"status": "PASS", "fresh": True}:
        raise RuntimeError("candidate quality lease is not fresh PASS")
    level = probe.source_sql("SELECT id FROM inventory_level ORDER BY id LIMIT 1;")
    baseline = probe.source_sql(f"SELECT incoming_quantity FROM inventory_level WHERE id='{level}';")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", level) or not re.fullmatch(r"[0-9]+", baseline):
        raise RuntimeError("unexpected clone inventory row")
    probe.source_sql(f"UPDATE inventory_level SET incoming_quantity=incoming_quantity+1 "
                     f"WHERE id='{level}';")
    try:
        deadline = time.monotonic() + 90
        while lease()["status"] != "BLOCKED_BY_QUALITY":
            if time.monotonic() >= deadline:
                raise RuntimeError("new CDC input did not revoke context quality lease")
            time.sleep(2)
    finally:
        probe.source_sql(f"UPDATE inventory_level SET incoming_quantity={baseline} "
                         f"WHERE id='{level}';")
    probe.catch_up()
    after = lease()
    if after["status"] != "BLOCKED_BY_QUALITY":
        raise RuntimeError("quality lease reopened without reconciliation")
    print(json.dumps({"status": "PASS_INVALIDATION", "before": before,
                      "after": after}, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError) as error:
        raise SystemExit(f"inventory-price-quality-invalidation-probe: {error}") from None
