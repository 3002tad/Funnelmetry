#!/usr/bin/env python3
"""Clone-only CDC kit fixture: one variant with two required inventory items.

Observe the Store API and reconciled stage-2 context before promoting any
inventory-kit resolver claim. The fixture is removed even when a check fails.
"""

import importlib.util
import json
import os
import re
import subprocess
import time
from decimal import Decimal, ROUND_FLOOR
from pathlib import Path


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "combined_transition", ROOT / "probe-combined-cdc-transition.py")
transition = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transition)
combined = transition.combined
api = transition.api
fixture = transition.fixture
governed = transition.inventory
catalog = transition.catalog

ITEM = "fm_cdc_combined_kit_item"
LINK = "fm_cdc_combined_kit_link"
LEVEL = "fm_cdc_combined_kit_level"
SKU = "FM-CDC-COMBINED-KIT"
STOCK = Decimal("5")
REQUIRED = Decimal("2")


def sql(statement):
    return fixture.sql(statement)


def fixture_count():
    parts = sql(f"""SELECT
      (SELECT count(*) FROM inventory_item WHERE id={fixture.quote(ITEM)}),
      (SELECT count(*) FROM product_variant_inventory_item WHERE id={fixture.quote(LINK)}),
      (SELECT count(*) FROM inventory_level WHERE id={fixture.quote(LEVEL)});""").split("|")
    return tuple(int(part) for part in parts)


def add(context):
    sql(f"""BEGIN;
INSERT INTO inventory_item(id,sku,requires_shipping,title)
 VALUES({fixture.quote(ITEM)},{fixture.quote(SKU)},true,'CDC clone kit item');
INSERT INTO product_variant_inventory_item(id,variant_id,inventory_item_id,
 required_quantity) VALUES({fixture.quote(LINK)},
 {fixture.quote(context['variant_id'])},{fixture.quote(ITEM)},{REQUIRED});
INSERT INTO inventory_level(id,inventory_item_id,location_id,stocked_quantity,
 reserved_quantity,incoming_quantity,raw_stocked_quantity,
 raw_reserved_quantity,raw_incoming_quantity)
 VALUES({fixture.quote(LEVEL)},{fixture.quote(ITEM)},
 {fixture.quote(context['location_id'])},{STOCK},0,0,
 jsonb_build_object('value',{fixture.quote(str(STOCK))},'precision',20),
 jsonb_build_object('value','0','precision',20),
 jsonb_build_object('value','0','precision',20));
COMMIT;""")


def remove():
    sql(f"""BEGIN;
DELETE FROM inventory_level WHERE id={fixture.quote(LEVEL)};
DELETE FROM product_variant_inventory_item WHERE id={fixture.quote(LINK)};
DELETE FROM inventory_item WHERE id={fixture.quote(ITEM)};
COMMIT;""")


def reconcile(timeout=180):
    deadline = time.monotonic() + timeout
    while True:
        first = catalog.old.evaluate(catalog.old.source(), catalog.projection(),
                                     catalog.old.topic_ends(), catalog.old.connector_running())
        second = governed.stage2.evaluate(
            governed.stage2.source_rows(), governed.candidate_rows(),
            governed.snapshot.topic_ends(), governed.candidate_offsets(),
            *governed.snapshot.connector_state(), governed.snapshot.source_slot())
        if first["status"] == "PASS" and second["status"] == "PASS_CONTEXT_ONLY":
            return second
        if time.monotonic() >= deadline:
            raise RuntimeError("combined catalog/stage-2 projections did not reconcile")
        time.sleep(5)


def main():
    if (os.environ.get("COMPOSE_PROJECT_NAME") != combined.PROJECT or
            not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}",
                             os.environ.get("CATALOG_CDC_COVERAGE_EPOCH", "")) or
            not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}",
                             os.environ.get("CDC_COVERAGE_EPOCH", ""))):
        raise RuntimeError("requires the exact isolated combined CDC clone and epochs")
    combined.verify_common_clone_source()
    if fixture_count() != (0, 0, 0):
        raise RuntimeError("kit fixture already exists; inspect clone before retrying")
    reconcile()
    context = api.sample_context()
    before = api.store_variant(context)
    if Decimal(str(before["inventory_quantity"])) < 2:
        raise RuntimeError("selected variant has insufficient baseline stock for kit probe")
    added = False
    report = None
    try:
        add(context)
        added = True
        result = reconcile()
        combined.stage2_probe.require_numeric_consistency()
        after = api.store_variant(context)
        observed = Decimal(str(after["inventory_quantity"]))
        expected = min(Decimal(str(before["inventory_quantity"])),
                       (STOCK / REQUIRED).to_integral_value(rounding=ROUND_FLOOR))
        publication = subprocess.run(
            ["python3", str(ROOT / "publish-catalog-governed-quality.py"),
             "--lease-seconds", "120", "--evidence-ref", "combined-c1-kit-20261030"],
            text=True, capture_output=True, check=False)
        if publication.returncode:
            raise RuntimeError("combined catalog quality publication failed")
        pair = combined.catalog_pair.resolve_pair(
            combined.catalog_observation(os.environ["CATALOG_CDC_COVERAGE_EPOCH"],
                                         context["product_id"], context["variant_id"]),
            source_id=combined.SOURCE_ID,
            coverage_epoch_id=os.environ["CATALOG_CDC_COVERAGE_EPOCH"])
        if pair["status"] != "PASS_CONTEXT_ONLY":
            raise RuntimeError("catalog CDC product/variant pair did not pass quality")
        rows = governed.candidate_rows()
        resolved = combined.stage2_probe.resolver.resolve_inventory(
            rows, product=pair["product"], variant=pair["variant"],
            sales_channel_id=context["sales_channel_id"],
            context_reconciled=True, verified_tables=result["table_counts"].keys())
        links = [r["payload"] for r in rows.get("product_variant_inventory_item", [])
                 if r.get("soft_deleted") is False and
                 r["payload"].get("variant_id") == context["variant_id"]]
        has_fixture_link = any(r.get("inventory_item_id") == ITEM and
                               Decimal(str(r.get("required_quantity"))) == REQUIRED
                               for r in links)
        resolver_matches = (resolved.get("status") == "PASS_SAMPLE_ONLY" and
                            Decimal(str(resolved.get("inventory_quantity"))) == observed)
        report = {"status": "PASS_SAMPLE_ONLY" if observed == expected and
                  has_fixture_link and resolver_matches else "BLOCKED_BY_QUALITY",
                  "store_api_inventory_quantity": str(observed),
                  "expected_kit_quantity": str(expected),
                  "cdc_kit_link_captured": has_fixture_link,
                  "stage2_reconciled": result["status"] == "PASS_CONTEXT_ONLY",
                  "catalog_source": "governed_cdc",
                  "inventory_source": "governed_cdc",
                  "resolver_reason": resolved.get("reason"),
                  "resolver_matches_store_api": resolver_matches}
        print(json.dumps(report, sort_keys=True), flush=True)
    finally:
        if added or fixture_count() != (0, 0, 0):
            remove()
            reconcile()
    restored = api.store_variant(context)
    if fixture_count() != (0, 0, 0) or restored != before:
        raise RuntimeError("kit fixture did not restore Store API and source state")
    print(json.dumps({"phase": "restored", "status": "RESTORED"}, sort_keys=True))
    return 0 if report and report["status"] == "PASS_SAMPLE_ONLY" else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired) as error:
        raise SystemExit(f"combined-cdc-kit: {error}") from None
