#!/usr/bin/env python3
"""Compare one target CDC stage-2 candidate context with Medusa Store API.

Read-only operator probe. It does not publish a business asset or change the
source, projection, Dashboard binding or candidate quality lease.
"""

import argparse
import importlib.util
import json
import re
import subprocess
import sys
from decimal import Decimal
from pathlib import Path


ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


target = load("target_projection", "verify-target-projections.py")
resolver = load("target_resolver", "inventory_price_resolution_candidate.py")


def verify(args):
    command = [sys.executable, str(ROOT / "verify-target-projections.py"),
               "--profile-dir", str(args.profile_dir),
               "--source-container", args.source_container,
               "--pipeline-container", args.pipeline_container,
               "--kafka-container", args.kafka_container,
               "--connect-container", args.connect_container]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode:
        raise RuntimeError("target source/projection quality is blocked")
    report = json.loads(result.stdout)
    if report.get("status") != "PASS_SHADOW_POINT_IN_TIME":
        raise RuntimeError("target source/projection quality is blocked")
    return report


def stable(before, after):
    return all(before[stream][field] == after[stream][field]
               for stream in ("catalog", "inventory_price")
               for field in ("source_digest", "projection_digest", "topic_end_offsets",
                             "applied_offsets"))


def context(source_container, key_id):
    sql = """SELECT json_build_object(
      'product_id',p.id,'variant_id',v.id,'sales_channel_id',pc.sales_channel_id,
      'region_id',r.id,'currency_code',r.currency_code)::text
    FROM api_key k
    JOIN publishable_api_key_sales_channel pub ON pub.publishable_key_id=k.id
      AND pub.deleted_at IS NULL
    JOIN product_sales_channel pc ON pc.sales_channel_id=pub.sales_channel_id
      AND pc.deleted_at IS NULL
    JOIN sales_channel sc ON sc.id=pc.sales_channel_id AND sc.deleted_at IS NULL
      AND NOT sc.is_disabled
    JOIN product p ON p.id=pc.product_id AND p.deleted_at IS NULL
      AND p.status='published'
    JOIN product_variant v ON v.product_id=p.id AND v.deleted_at IS NULL
      AND v.manage_inventory AND NOT v.allow_backorder
    JOIN product_variant_inventory_item vi ON vi.variant_id=v.id
      AND vi.deleted_at IS NULL AND vi.required_quantity=1
    JOIN inventory_item ii ON ii.id=vi.inventory_item_id AND ii.deleted_at IS NULL
    JOIN sales_channel_stock_location scl ON scl.sales_channel_id=pc.sales_channel_id
      AND scl.deleted_at IS NULL
    JOIN stock_location sl ON sl.id=scl.stock_location_id AND sl.deleted_at IS NULL
    JOIN inventory_level il ON il.inventory_item_id=vi.inventory_item_id
      AND il.location_id=scl.stock_location_id AND il.deleted_at IS NULL
    JOIN product_variant_price_set vp ON vp.variant_id=v.id AND vp.deleted_at IS NULL
    JOIN price_set ps ON ps.id=vp.price_set_id AND ps.deleted_at IS NULL
    JOIN region r ON r.currency_code='eur' AND r.deleted_at IS NULL
    JOIN price pr ON pr.price_set_id=vp.price_set_id
      AND pr.currency_code=r.currency_code AND pr.price_list_id IS NULL
      AND pr.rules_count=0 AND pr.deleted_at IS NULL
    WHERE k.id='""" + key_id + """' AND k.type='publishable'
      AND k.deleted_at IS NULL AND k.revoked_at IS NULL
      AND (SELECT count(*) FROM product_variant_inventory_item vi2
           WHERE vi2.variant_id=v.id AND vi2.deleted_at IS NULL)=1
      AND (SELECT count(*) FROM sales_channel_stock_location scl2
           WHERE scl2.sales_channel_id=pc.sales_channel_id AND scl2.deleted_at IS NULL)=1
    ORDER BY p.id,v.id LIMIT 1;"""
    value = target.source(source_container, sql)
    if not isinstance(value, dict) or not all(re.fullmatch(r"[A-Za-z0-9_-]+", value.get(k, ""))
                                               for k in ("product_id", "variant_id",
                                                         "sales_channel_id", "region_id",
                                                         "currency_code")):
        raise ValueError("no eligible target product/variant context")
    return value


def numeric_consistent(source_container):
    value = target.source(source_container, """SELECT json_build_object(
      'inventory_mismatch',(SELECT count(*) FROM inventory_level WHERE
        (raw_stocked_quantity->>'value')::numeric IS DISTINCT FROM stocked_quantity OR
        (raw_reserved_quantity->>'value')::numeric IS DISTINCT FROM reserved_quantity OR
        (raw_incoming_quantity->>'value')::numeric IS DISTINCT FROM incoming_quantity),
      'price_mismatch',(SELECT count(*) FROM price WHERE
        (raw_amount->>'value')::numeric IS DISTINCT FROM amount OR
        (raw_min_quantity->>'value')::numeric IS DISTINCT FROM min_quantity OR
        (raw_max_quantity->>'value')::numeric IS DISTINCT FROM max_quantity))::text;""")
    return value == {"inventory_mismatch": 0, "price_mismatch": 0}


def store_variant(backend_container, source_container, key_id, context_value):
    token = target.source(source_container,
        "SELECT to_json(token)::text FROM api_key WHERE id='" + key_id +
        "' AND type='publishable' AND revoked_at IS NULL AND deleted_at IS NULL;")
    if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9._-]{12,256}", token):
        raise ValueError("no active Store API token for selected key ID")
    script = """
const c=JSON.parse(process.env.TARGET_CONTEXT);
const q=new URLSearchParams({fields:'*variants.calculated_price,+variants.inventory_quantity',
  region_id:c.region_id});
const u='http://127.0.0.1:9000/store/products/'+encodeURIComponent(c.product_id)+'?'+q;
const response=await fetch(u,{headers:{'x-publishable-api-key':process.env.SHADOW_PUBLISHABLE_KEY}});
if(!response.ok){console.log(JSON.stringify({http_status:response.status}));process.exit(2)}
const body=await response.json();
const variant=(body.product?.variants??[]).find(v=>v.id===c.variant_id);
console.log(JSON.stringify({http_status:response.status,variant_found:!!variant,
  inventory_quantity:variant?.inventory_quantity??null,
  calculated_amount:variant?.calculated_price?.calculated_amount??null,
  calculated_currency_code:variant?.calculated_price?.currency_code??null}));
"""
    result = subprocess.run(["docker", "exec", "-i", "-e",
                             f"SHADOW_PUBLISHABLE_KEY={token}", "-e",
                             "TARGET_CONTEXT=" + json.dumps(context_value),
                             backend_container, "node", "-"], input=script,
                            text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError("target Store API context lookup failed")
    value = json.loads(result.stdout)
    if value.get("http_status") != 200 or value.get("variant_found") is not True:
        raise RuntimeError("target Store API variant unavailable")
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile-dir", type=Path, required=True)
    parser.add_argument("--source-container", required=True)
    parser.add_argument("--pipeline-container", required=True)
    parser.add_argument("--kafka-container", required=True)
    parser.add_argument("--connect-container", required=True)
    parser.add_argument("--backend-container", required=True)
    parser.add_argument("--publishable-key-id", required=True)
    args = parser.parse_args()
    if args.source_container != "medusa_reference-postgres-1" or \
            args.backend_container != "medusa_reference-backend-1" or \
            not re.fullmatch(r"apk_[A-Za-z0-9]+", args.publishable_key_id) or \
            any(not re.fullmatch(r"[a-f0-9]{12,64}", item) for item in
                (args.pipeline_container, args.kafka_container, args.connect_container)):
        raise ValueError("exact target containers and publishable key ID required")
    before = verify(args)
    selected = context(args.source_container, args.publishable_key_id)
    if not numeric_consistent(args.source_container):
        raise RuntimeError("source numeric/raw values do not agree")
    _, catalog = target.catalog_rows(args.source_container, args.pipeline_container,
                                      "cdc11_catalog_epoch1")
    _, stage_rows = target.stage2_rows(args.source_container, args.pipeline_container,
                                       "cdc11_inventory_price_epoch1")
    product = next((p for p in catalog["product"] if p["id"] == selected["product_id"]), None)
    variant = next((v for v in catalog["product_variant"]
                    if v["id"] == selected["variant_id"]), None)
    product = ({"product_id": product["id"], "status": product["status"],
                "soft_deleted": product["deleted"]} if product else None)
    variant = ({"variant_id": variant["id"], "product_id": variant["product_id"],
                "manage_inventory": variant["manage_inventory"],
                "allow_backorder": variant["allow_backorder"],
                "soft_deleted": variant["deleted"]} if variant else None)
    tables = before["inventory_price"]["table_counts"].keys()
    inventory = resolver.resolve_inventory(stage_rows, product=product, variant=variant,
        sales_channel_id=selected["sales_channel_id"], context_reconciled=True,
        verified_tables=tables)
    price = resolver.resolve_default_price(stage_rows, variant_id=selected["variant_id"],
        currency_code=selected["currency_code"], region_id=selected["region_id"],
        context_reconciled=True, verified_tables=tables)
    observed = store_variant(args.backend_container, args.source_container,
                             args.publishable_key_id, selected)
    after = verify(args)
    checks = {
        "source_projection_stable": stable(before, after),
        "inventory_candidate_resolved": inventory.get("status") == "PASS_SAMPLE_ONLY",
        "inventory_matches_store_api": inventory.get("inventory_quantity") ==
                                        observed["inventory_quantity"],
        "price_candidate_resolved": price.get("status") == "PASS_SAMPLE_ONLY",
        "price_matches_store_api": price.get("amount") is not None and
            observed["calculated_amount"] is not None and
            Decimal(price["amount"]) == Decimal(str(observed["calculated_amount"])),
        "currency_matches_store_api": price.get("currency_code") ==
                                      observed["calculated_currency_code"],
    }
    print(json.dumps({"status": "PASS_SAMPLE_ONLY" if all(checks.values()) else
                      "BLOCKED_BY_QUALITY", "checks": checks,
                      "product_id": selected["product_id"],
                      "variant_id": selected["variant_id"],
                      "inventory_reason": inventory.get("reason"),
                      "price_reason": price.get("reason")}, sort_keys=True))
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, RuntimeError, OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"target-inventory-price-resolver: {error}") from None
