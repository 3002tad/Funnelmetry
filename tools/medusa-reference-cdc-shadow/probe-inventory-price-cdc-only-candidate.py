#!/usr/bin/env python3
"""Clone-only CDC catalog + inventory/price read-path candidate.

Both governed projections must be attached to the same isolated Medusa clone.
No Medusa Admin/Store API is used to supply product or variant flags here.
"""

import importlib.util
import json
import os
import re
import subprocess
from decimal import Decimal
from pathlib import Path


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "stage2_probe", ROOT / "probe-inventory-price-resolver-candidate.py")
stage2_probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage2_probe)
spec = importlib.util.spec_from_file_location(
    "catalog_pair", ROOT / "catalog_cdc_pair_candidate.py")
catalog_pair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalog_pair)

SOURCE_ID = "medusa-reference"
PROJECT = "funnelmetry_cdc_combined_shadow_c1"
CATALOG_COMPOSE = ["docker", "compose", "-f", str(ROOT / "compose.yml"),
                   "-f", str(ROOT / "compose.catalog-projection.yml")]


def quote(value):
    return "'" + value.replace("'", "''") + "'"


def catalog_observation(epoch, product_id, variant_id):
    statement = f"""
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT json_build_object(
 'product', (SELECT row_to_json(p) FROM catalog_cdc_products_current p
   WHERE p.source_id={quote(SOURCE_ID)} AND p.coverage_epoch_id={quote(epoch)}
   AND p.product_id={quote(product_id)}),
 'variant', (SELECT row_to_json(v) FROM catalog_cdc_variants_current v
   WHERE v.source_id={quote(SOURCE_ID)} AND v.coverage_epoch_id={quote(epoch)}
   AND v.variant_id={quote(variant_id)}),
 'quality', (SELECT row_to_json(q) FROM catalog_cdc_quality_lease q
   WHERE q.source_id={quote(SOURCE_ID)}),
 'current_offsets', (SELECT COALESCE(json_object_agg(topic,next_offset),'{{}}'::json)
   FROM catalog_cdc_input_offsets WHERE source_id={quote(SOURCE_ID)}
   AND coverage_epoch_id={quote(epoch)} AND partition=0))::text;
COMMIT;
"""
    command = CATALOG_COMPOSE + ["exec", "-T", "catalog-projection-db", "psql",
                                 "-X", "-U", "catalog_projection", "-d",
                                 "catalog_projection", "-At", "-v", "ON_ERROR_STOP=1"]
    completed = subprocess.run(command, input=statement, text=True,
                               capture_output=True, check=False)
    if completed.returncode:
        raise RuntimeError("catalog CDC projection unavailable")
    rows = [line for line in completed.stdout.splitlines() if line.startswith("{")]
    if len(rows) != 1:
        raise RuntimeError("catalog CDC observation has unexpected shape")
    return json.loads(rows[0])


def verify_common_clone_source():
    expected = {
        "medusa-cdc-catalog-shadow": ("funnelmetry_cdc_catalog_shadow",
                                      "cdc_shadow_medusa_catalog"),
        "medusa-cdc-inventory-price-shadow-v2": (
            "funnelmetry_cdc_inventory_price_shadow_v2",
            "cdc_shadow_medusa_inventory_price_v2"),
    }
    for connector, (slot, prefix) in expected.items():
        command = CATALOG_COMPOSE + [
            "exec", "-T", "connect", "curl", "-fsS", "--max-time", "10",
            f"http://127.0.0.1:8083/connectors/{connector}/config"]
        completed = subprocess.run(command, text=True, capture_output=True, check=False)
        if completed.returncode:
            raise RuntimeError("CDC connector configuration unavailable")
        config = json.loads(completed.stdout)
        if (config.get("database.hostname") != "postgres" or
                config.get("database.port") != "5432" or
                config.get("database.dbname") != "medusa" or
                config.get("slot.name") != slot or
                config.get("topic.prefix") != prefix):
            raise RuntimeError("catalog and inventory CDC do not share this clone source")


def main():
    epoch = os.environ.get("CATALOG_CDC_COVERAGE_EPOCH", "")
    inventory_epoch = os.environ.get("CDC_COVERAGE_EPOCH", "")
    if (os.environ.get("COMPOSE_PROJECT_NAME") != PROJECT or
            not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}", inventory_epoch) or
            not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}", epoch)):
        raise RuntimeError("requires exact combined isolated clone and catalog epoch")
    verify_common_clone_source()
    stage2_probe.api.fixture.reconcile()
    observed = stage2_probe.api.sample_context()
    governed = stage2_probe.governed
    stage2 = governed.stage2.evaluate(
        governed.stage2.source_rows(), governed.candidate_rows(),
        governed.snapshot.topic_ends(), governed.candidate_offsets(),
        *governed.snapshot.connector_state(), governed.snapshot.source_slot())
    if stage2["status"] != "PASS_CONTEXT_ONLY":
        raise RuntimeError("inventory/price CDC context not reconciled")
    stage2_probe.require_numeric_consistency()
    pair = catalog_pair.resolve_pair(catalog_observation(
        epoch, observed["product_id"], observed["variant_id"]),
        source_id=SOURCE_ID, coverage_epoch_id=epoch)
    if pair["status"] != "PASS_CONTEXT_ONLY":
        print(json.dumps({"status": pair["status"], "reason": pair["reason"]}))
        return 1
    rows = governed.candidate_rows()
    verified = stage2["table_counts"].keys()
    inventory = stage2_probe.resolver.resolve_inventory(
        rows, product=pair["product"], variant=pair["variant"],
        sales_channel_id=observed["sales_channel_id"],
        context_reconciled=True, verified_tables=verified)
    price = stage2_probe.resolver.resolve_default_price(
        rows, variant_id=observed["variant_id"],
        currency_code=observed["currency_code"], region_id=observed["region_id"],
        context_reconciled=True, verified_tables=verified)
    # Store API is used solely as an independent comparison oracle.
    api_result = stage2_probe.api.store_variant(observed)
    matches = (inventory.get("status") == "PASS_SAMPLE_ONLY" and
               price.get("status") == "PASS_SAMPLE_ONLY" and
               inventory.get("inventory_quantity") == api_result["inventory_quantity"] and
               price.get("currency_code") == api_result["calculated_currency_code"] and
               Decimal(price["amount"]) == Decimal(str(api_result["calculated_amount"])))
    print(json.dumps({"status": "PASS_SAMPLE_ONLY" if matches else "BLOCKED_BY_QUALITY",
                      "catalog_source": "governed_cdc", "inventory_source": "governed_cdc",
                      "catalog_epoch": epoch, "inventory_epoch": inventory_epoch,
                      "inventory_reason": inventory.get("reason"),
                      "price_reason": price.get("reason")}, sort_keys=True))
    return 0 if matches else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, OSError) as error:
        raise SystemExit(f"inventory-price-cdc-only-candidate: {error}") from None
