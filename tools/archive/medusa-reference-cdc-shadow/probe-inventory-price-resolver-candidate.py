#!/usr/bin/env python3
"""Compare the governed CDC resolver candidate with one isolated Store API case."""

import importlib.util
import json
import os
from decimal import Decimal
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


api = load("stage2_api", "probe-inventory-price-api-semantics.py")
governed = load("stage2_governed", "verify-inventory-price-governed-candidate.py")
resolver = load("stage2_resolver", "inventory_price_resolution_candidate.py")
numeric = load("stage2_numeric", "verify-inventory-price-source-numeric.py")


def require_numeric_consistency():
    # Medusa reads raw_* values. CDC captures the corresponding numeric columns;
    # equality is required before comparing their answers with Store API.
    if not numeric.passed(numeric.inspect()):
        raise RuntimeError("source numeric/raw quantities or prices disagree")


def source_catalog(context):
    statement = f"""SELECT json_build_object(
      'product', (SELECT json_build_object('product_id',id,'status',status,
       'soft_deleted',deleted_at IS NOT NULL) FROM product
       WHERE id={api.fixture.quote(context['product_id'])}),
      'variant', (SELECT json_build_object('variant_id',id,'product_id',product_id,
       'manage_inventory',manage_inventory,'allow_backorder',allow_backorder,
       'soft_deleted',deleted_at IS NOT NULL) FROM product_variant
       WHERE id={api.fixture.quote(context['variant_id'])}))::text;"""
    return json.loads(api.fixture.sql(statement))


def main():
    if os.environ.get("COMPOSE_PROJECT_NAME") != "funnelmetry_cdc_inventory_price_shadow_stage2b" or \
            os.environ.get("CDC_COVERAGE_EPOCH") != api.fixture.EPOCH:
        raise RuntimeError("requires exact isolated stage2b clone and epoch")
    api.fixture.reconcile()
    governed_result = governed.stage2.evaluate(
        governed.stage2.source_rows(), governed.candidate_rows(),
        governed.snapshot.topic_ends(), governed.candidate_offsets(),
        *governed.snapshot.connector_state(), governed.snapshot.source_slot())
    if governed_result["status"] != "PASS_CONTEXT_ONLY":
        raise RuntimeError("governed CDC context has not reconciled with source")
    require_numeric_consistency()
    context = api.sample_context()
    catalog = source_catalog(context)
    rows = governed.candidate_rows()
    verified_tables = governed_result["table_counts"].keys()
    availability = resolver.resolve_inventory(
        rows, product=catalog["product"], variant=catalog["variant"],
        sales_channel_id=context["sales_channel_id"], context_reconciled=True,
        verified_tables=verified_tables)
    price = resolver.resolve_default_price(
        rows, variant_id=context["variant_id"], currency_code=context["currency_code"],
        region_id=context["region_id"], context_reconciled=True,
        verified_tables=verified_tables)
    observed = api.store_variant(context)
    checks = {
        "availability_resolved": availability.get("status") == "PASS_SAMPLE_ONLY",
        "inventory_matches_store_api": availability.get("inventory_quantity") ==
                                       observed["inventory_quantity"],
        "price_resolved": price.get("status") == "PASS_SAMPLE_ONLY",
        "price_matches_store_api": price.get("amount") is not None and
            Decimal(price["amount"]) == Decimal(str(observed["calculated_amount"])),
        "currency_matches_store_api": price.get("currency_code") ==
                                      observed["calculated_currency_code"],
    }
    print(json.dumps({"status": "PASS_SAMPLE_ONLY" if all(checks.values()) else
                      "BLOCKED_BY_QUALITY", "checks": checks,
                      "availability_reason": availability.get("reason"),
                      "price_reason": price.get("reason")}, sort_keys=True))
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, OSError) as error:
        raise SystemExit(f"inventory-price-resolver-candidate: {error}") from None
