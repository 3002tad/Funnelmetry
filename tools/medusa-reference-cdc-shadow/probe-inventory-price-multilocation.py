#!/usr/bin/env python3
"""Test a second stock location against Store API and governed CDC on stage2b.

The fixture is installed and removed only on the exact isolated Medusa clone.
It does not change live source data or activate an analytical binding.
"""

import argparse
import importlib.util
import json
import os
import subprocess
import time
from decimal import Decimal
from pathlib import Path


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("stage2_api", ROOT / "probe-inventory-price-api-semantics.py")
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)
spec = importlib.util.spec_from_file_location(
    "resolver_probe", ROOT / "probe-inventory-price-resolver-candidate.py")
resolver_probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resolver_probe)
fixture = api.fixture
PROJECT = "funnelmetry_cdc_inventory_price_shadow_stage2b"
LOCATION = "fm_cdc_stage2b_location_probe"
LINK = "fm_cdc_stage2b_location_link_probe"
LEVEL = "fm_cdc_stage2b_level_probe"
ADDED_STOCK = Decimal("7")


def fixture_count():
    return tuple(int(part) for part in fixture.sql(f"""SELECT
      (SELECT count(*) FROM stock_location WHERE id={fixture.quote(LOCATION)}),
      (SELECT count(*) FROM sales_channel_stock_location WHERE id={fixture.quote(LINK)}),
      (SELECT count(*) FROM inventory_level WHERE id={fixture.quote(LEVEL)});""").split("|"))


def add(context):
    fixture.sql(f"""BEGIN;
INSERT INTO stock_location(id,name) VALUES({fixture.quote(LOCATION)},'CDC stage2b location probe');
INSERT INTO sales_channel_stock_location(id,sales_channel_id,stock_location_id)
 VALUES({fixture.quote(LINK)},{fixture.quote(context['sales_channel_id'])},
        {fixture.quote(LOCATION)});
INSERT INTO inventory_level(id,inventory_item_id,location_id,stocked_quantity,
 reserved_quantity,incoming_quantity,raw_stocked_quantity,
 raw_reserved_quantity,raw_incoming_quantity) VALUES({fixture.quote(LEVEL)},
 {fixture.quote(context['item_id'])},{fixture.quote(LOCATION)},{ADDED_STOCK},0,0,
 jsonb_build_object('value',{fixture.quote(str(ADDED_STOCK))},'precision',20),
 jsonb_build_object('value','0','precision',20),
 jsonb_build_object('value','0','precision',20));
COMMIT;""")


def remove():
    fixture.sql(f"""BEGIN;
DELETE FROM inventory_level WHERE id={fixture.quote(LEVEL)};
DELETE FROM sales_channel_stock_location WHERE id={fixture.quote(LINK)};
DELETE FROM stock_location WHERE id={fixture.quote(LOCATION)};
COMMIT;""")


def restart_cache_and_backend():
    result = subprocess.run(fixture.BASE + ["restart", "redis", "backend"],
                            text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError("isolated Medusa cache/backend restart failed")


def governed_resolution(context):
    governed = resolver_probe.governed
    deadline = time.monotonic() + 120
    while True:
        result = governed.stage2.evaluate(
            governed.stage2.source_rows(), governed.candidate_rows(),
            governed.snapshot.topic_ends(), governed.candidate_offsets(),
            *governed.snapshot.connector_state(), governed.snapshot.source_slot())
        if result["status"] == "PASS_CONTEXT_ONLY":
            catalog = resolver_probe.source_catalog(context)
            return resolver_probe.resolver.resolve_inventory(
                governed.candidate_rows(), product=catalog["product"],
                variant=catalog["variant"],
                sales_channel_id=context["sales_channel_id"],
                context_reconciled=True,
                verified_tables=result["table_counts"].keys())
        if time.monotonic() >= deadline:
            raise RuntimeError("governed CDC context did not catch up to fixture")
        time.sleep(5)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh-medusa-cache", action="store_true")
    args = parser.parse_args()
    if os.environ.get("COMPOSE_PROJECT_NAME") != PROJECT or \
            os.environ.get("CDC_COVERAGE_EPOCH") != fixture.EPOCH:
        raise RuntimeError("requires exact isolated stage2b clone and epoch")
    if fixture_count() != (0, 0, 0):
        raise RuntimeError("multilocation fixture IDs already exist; inspect clone")
    fixture.reconcile()
    context = api.sample_context()
    before = api.store_variant(context)
    added = False
    try:
        add(context)
        added = True
        fixture.reconcile()
        if args.refresh_medusa_cache:
            restart_cache_and_backend()
        after = api.store_variant(context)
        resolved = governed_resolution(context)
        expected = Decimal(str(before["inventory_quantity"])) + ADDED_STOCK
        actual = Decimal(str(after["inventory_quantity"]))
        resolver_matches = (resolved.get("status") == "PASS_SAMPLE_ONLY" and
                            Decimal(str(resolved.get("inventory_quantity"))) == actual)
        report = {
            "status": "PASS_SAMPLE_ONLY" if actual == expected and resolver_matches else
                      "BLOCKED_BY_QUALITY",
            "stock_delta_expected": str(ADDED_STOCK),
            "stock_delta_observed": str(actual - Decimal(str(before["inventory_quantity"]))),
            "cdc_reconciled": True,
            "resolver_matches_store_api": resolver_matches,
            "cache_refreshed": args.refresh_medusa_cache,
        }
        print(json.dumps(report, sort_keys=True))
    finally:
        if added:
            remove()
            fixture.reconcile()
            if args.refresh_medusa_cache:
                restart_cache_and_backend()
    restored = api.store_variant(context)
    if fixture_count() != (0, 0, 0) or restored["inventory_quantity"] != before["inventory_quantity"]:
        raise RuntimeError("multilocation clone fixture did not restore")
    print(json.dumps({"phase": "restored", "status": "RESTORED"}, sort_keys=True))
    return 0 if report["status"] == "PASS_SAMPLE_ONLY" else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, OSError) as error:
        raise SystemExit(f"cdc-multilocation-probe: {error}") from None
