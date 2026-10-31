#!/usr/bin/env python3
"""Compare one isolated inventory/price CDC fixture with Medusa Store API.

This probe runs only against the stage2b clone and restores every inserted row.
It proves one controlled context, not Medusa pricing/inventory in general.
"""

import importlib.util
import json
import os
import re
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("stage2_nonempty", ROOT / "probe-inventory-price-nonempty.py")
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
PROJECT = os.environ.get("COMPOSE_PROJECT_NAME", "")


def sample_context():
    statement = """SELECT json_build_object(
      'token',k.token,'key_id',k.id,'sales_channel_id',pc.sales_channel_id,
      'product_id',p.id,'variant_id',v.id,'manage_inventory',v.manage_inventory,
      'allow_backorder',v.allow_backorder,'item_id',vi.inventory_item_id,
      'required_quantity',vi.required_quantity,'location_id',il.location_id,
      'stocked_quantity',il.stocked_quantity,'reserved_quantity',il.reserved_quantity,
      'price_set_id',vp.price_set_id,'region_id',r.id,
      'currency_code',r.currency_code,'default_amount',pr.amount)::text
    FROM api_key k
    JOIN publishable_api_key_sales_channel pub
      ON pub.publishable_key_id=k.id AND pub.deleted_at IS NULL
    JOIN product_sales_channel pc
      ON pc.sales_channel_id=pub.sales_channel_id AND pc.deleted_at IS NULL
    JOIN sales_channel sc ON sc.id=pc.sales_channel_id
      AND sc.deleted_at IS NULL AND NOT sc.is_disabled
    JOIN product p ON p.id=pc.product_id
      AND p.deleted_at IS NULL AND p.status='published'
    JOIN product_variant v ON v.product_id=p.id
      AND v.deleted_at IS NULL AND v.manage_inventory AND NOT v.allow_backorder
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
    JOIN price pr ON pr.price_set_id=vp.price_set_id AND pr.currency_code=r.currency_code
      AND pr.price_list_id IS NULL AND pr.rules_count=0 AND pr.deleted_at IS NULL
      AND pr.amount>8
    WHERE k.type='publishable' AND k.deleted_at IS NULL AND k.revoked_at IS NULL
      AND (SELECT count(*) FROM product_variant_inventory_item vi2
           WHERE vi2.variant_id=v.id AND vi2.deleted_at IS NULL)=1
      AND (SELECT count(*) FROM sales_channel_stock_location scl2
           WHERE scl2.sales_channel_id=pc.sales_channel_id AND scl2.deleted_at IS NULL)=1
    ORDER BY p.id,v.id LIMIT 1;"""
    value = json.loads(fixture.sql(statement))
    if not value.get("token"):
        raise RuntimeError("no usable publishable key on isolated clone")
    for name in ("key_id", "product_id", "variant_id", "item_id", "location_id", "region_id",
                 "sales_channel_id", "price_set_id", "currency_code"):
        if not re.fullmatch(r"[A-Za-z0-9_-]+", value[name]):
            raise RuntimeError("unexpected clone source identifier")
    return value


def store_variant(context):
    request = {"token": context["token"], "product_id": context["product_id"],
               "variant_id": context["variant_id"], "region_id": context["region_id"]}
    script = """
const input=__INPUT__;
const query=new URLSearchParams({
  fields:'*variants.calculated_price,+variants.inventory_quantity',
  region_id:input.region_id
});
const response=await fetch('http://127.0.0.1:9000/store/products/'+
  encodeURIComponent(input.product_id)+'?'+query.toString(),{
    headers:{'x-publishable-api-key':input.token}
  });
if(!response.ok){console.log(JSON.stringify({http_status:response.status}));process.exit(2)}
const body=await response.json();
const variant=(body.product?.variants??[]).find(v=>v.id===input.variant_id);
console.log(JSON.stringify({
  http_status:response.status, variant_found:!!variant,
  inventory_quantity:variant?.inventory_quantity??null,
  calculated_amount:variant?.calculated_price?.calculated_amount??null,
  calculated_currency_code:variant?.calculated_price?.currency_code??null,
  price_list_type:variant?.calculated_price?.calculated_price?.price_list_type??null
}));
""".replace("__INPUT__", json.dumps(request))
    for attempt in range(30):
        result = subprocess.run(["docker", "exec", "-i", f"{PROJECT}-backend-1", "node", "-"],
                                input=script, text=True,
                                capture_output=True, check=False)
        if result.returncode == 0:
            break
        if attempt == 29:
            raise RuntimeError("isolated Store API did not become ready within 90 seconds")
        time.sleep(3)
    lines = [line for line in result.stdout.splitlines() if line.startswith("{")]
    if len(lines) != 1:
        raise RuntimeError("unexpected isolated Store API response")
    value = json.loads(lines[0])
    if value.get("http_status") != 200 or not value.get("variant_found"):
        raise RuntimeError("selected variant was unavailable from clone Store API")
    return value


def main():
    if PROJECT != "funnelmetry_cdc_inventory_price_shadow_stage2b" or \
            os.environ.get("CDC_COVERAGE_EPOCH") != fixture.EPOCH:
        raise RuntimeError("requires the exact isolated stage2b clone and epoch")
    services = set(fixture.verifier.snapshot.run(
        fixture.BASE + ["ps", "--services", "--status", "running"]).splitlines())
    if services != {"postgres", "kafka", "connect", "inventory-price-projection-db",
                    "inventory-price-projector", "backend", "redis", "source-ingress"}:
        raise RuntimeError("requires only the isolated CDC and Medusa clone services")
    if any(fixture.fixture_count().values()):
        raise RuntimeError("fixture IDs already exist; inspect clone before retrying")
    fixture.reconcile()
    context = sample_context()
    baseline = store_variant(context)
    fixture.insert(context)
    try:
        fixture.reconcile()
        changed = store_variant(context)
        expected_inventory = float(context["stocked_quantity"]) - float(context["reserved_quantity"]) - 2
        result = {"baseline_inventory": baseline["inventory_quantity"],
                  "changed_inventory": changed["inventory_quantity"],
                  "expected_changed_inventory": expected_inventory,
                  "baseline_price": baseline["calculated_amount"],
                  "changed_price": changed["calculated_amount"],
                  "price_list_type": changed["price_list_type"]}
        result["inventory_matches"] = (
            baseline["inventory_quantity"] == float(context["stocked_quantity"]) -
            float(context["reserved_quantity"]) and
            changed["inventory_quantity"] == expected_inventory)
        result["price_matches"] = (baseline["calculated_amount"] == float(context["default_amount"])
                                   and changed["calculated_amount"] == 8)
        result["status"] = "PASS_SAMPLE_ONLY" if result["inventory_matches"] and result["price_matches"] \
            else "BLOCKED_BY_QUALITY"
        print(json.dumps(result, sort_keys=True), flush=True)
    finally:
        fixture.remove(context)
    fixture.reconcile()
    restored = store_variant(context)
    if restored["inventory_quantity"] != baseline["inventory_quantity"] or \
            restored["calculated_amount"] != baseline["calculated_amount"] or \
            any(fixture.fixture_count().values()):
        raise RuntimeError("Store API or source fixture did not restore")
    print(json.dumps({"phase": "restored", "status": "RESTORED"}, sort_keys=True))
    return 0 if result["status"] == "PASS_SAMPLE_ONLY" else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired) as error:
        raise SystemExit(f"cdc-inventory-price-api-semantics: {error}") from None
