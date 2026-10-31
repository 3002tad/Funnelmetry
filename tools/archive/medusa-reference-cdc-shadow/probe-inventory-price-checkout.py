#!/usr/bin/env python3
"""Reconcile a managed-variant Medusa checkout with CDC and Store API on stage2b."""

import importlib.util
import json
import os
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("stage2_api", ROOT / "probe-inventory-price-api-semantics.py")
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)
fixture = api.fixture
PROJECT = os.environ.get("COMPOSE_PROJECT_NAME", "")


def source_state(context):
    query = f"""SELECT json_build_object(
      'stocked',(SELECT stocked_quantity FROM inventory_level
         WHERE inventory_item_id={fixture.quote(context['item_id'])}
           AND location_id={fixture.quote(context['location_id'])} AND deleted_at IS NULL),
      'reserved',(SELECT reserved_quantity FROM inventory_level
         WHERE inventory_item_id={fixture.quote(context['item_id'])}
           AND location_id={fixture.quote(context['location_id'])} AND deleted_at IS NULL),
      'reservation_sum',(SELECT COALESCE(sum(quantity),0) FROM reservation_item
         WHERE inventory_item_id={fixture.quote(context['item_id'])}
           AND location_id={fixture.quote(context['location_id'])} AND deleted_at IS NULL))::text;"""
    return json.loads(fixture.sql(query))


def main():
    if PROJECT != "funnelmetry_cdc_inventory_price_shadow_stage2b" or \
            os.environ.get("CDC_COVERAGE_EPOCH") != fixture.EPOCH:
        raise RuntimeError("requires exact isolated stage2b clone and epoch")
    services = set(fixture.verifier.snapshot.run(
        fixture.BASE + ["ps", "--services", "--status", "running"]).splitlines())
    if services != {"postgres", "kafka", "connect", "inventory-price-projection-db",
                    "inventory-price-projector", "backend", "redis", "source-ingress"}:
        raise RuntimeError("requires only isolated CDC and Medusa clone services")
    context = api.sample_context()
    fixture.reconcile()
    before_db = source_state(context)
    before_api = api.store_variant(context)
    if before_api["inventory_quantity"] != float(before_db["stocked"]) - float(before_db["reserved"]):
        raise RuntimeError("baseline Store API inventory differs from source available quantity")
    environment = os.environ.copy()
    environment["SHADOW_PUBLISHABLE_KEY_ID"] = context["key_id"]
    environment["SHADOW_VARIANT_ID"] = context["variant_id"]
    result = subprocess.run(["python3", str(ROOT / "run-store-js.py"), "checkout-shadow.mjs"],
                            cwd=ROOT, env=environment, text=True, capture_output=True,
                            check=False)
    if result.returncode:
        raise RuntimeError("managed-variant checkout failed on isolated clone")
    order_ids = re.findall(r"^shadow_order=(order_[A-Za-z0-9]+)$", result.stdout, re.M)
    if len(order_ids) != 1:
        raise RuntimeError("clone checkout did not return exactly one order")
    fixture.reconcile()
    after_db = source_state(context)
    after_api = api.store_variant(context)
    checks = {
        "medusa_reservation_created": float(after_db["reservation_sum"]) -
                                      float(before_db["reservation_sum"]) == 1,
        "level_reserved_incremented": float(after_db["reserved"]) -
                                      float(before_db["reserved"]) == 1,
        "level_stocked_unchanged": float(after_db["stocked"]) == float(before_db["stocked"]),
        "store_available_decremented": after_api["inventory_quantity"] ==
                                       before_api["inventory_quantity"] - 1,
        "price_stable": after_api["calculated_amount"] == before_api["calculated_amount"],
    }
    report = {"status": "PASS_SAMPLE_ONLY" if all(checks.values()) else "BLOCKED_BY_QUALITY",
              "order_id": order_ids[0], "variant_id": context["variant_id"],
              "before_inventory": before_api["inventory_quantity"],
              "after_inventory": after_api["inventory_quantity"],
              "checks": checks}
    print(json.dumps(report, sort_keys=True))
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired) as error:
        raise SystemExit(f"cdc-inventory-price-checkout-probe: {error}") from None
