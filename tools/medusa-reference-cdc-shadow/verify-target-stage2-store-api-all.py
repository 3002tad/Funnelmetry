#!/usr/bin/env python3
"""Compare every currently published variant's CDC price and managed stock with Store API.

Read-only and target-specific. This verifies the current simple shapes only;
it does not publish price/availability assets or certify future price lists.
"""

import argparse
import collections
import importlib.util
import json
import re
import subprocess
from decimal import Decimal
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


target = load("target_projection", "verify-target-projections.py")
comparison = load("target_comparison", "verify-target-inventory-price-resolver.py")
resolver = load("target_resolver", "inventory_price_resolution_candidate.py")


def contexts(source_container):
    query = """SELECT COALESCE(json_agg(json_build_object(
      'product_id',p.id,'variant_id',v.id,'sales_channel_id',pub.sales_channel_id,
      'publishable_key_id',k.id,'region_id',r.id,'currency_code',r.currency_code)
      ORDER BY k.id,p.id,v.id),'[]'::json)::text
    FROM api_key k
    JOIN publishable_api_key_sales_channel pub ON pub.publishable_key_id=k.id
      AND pub.deleted_at IS NULL
    JOIN product_sales_channel pc ON pc.sales_channel_id=pub.sales_channel_id
      AND pc.deleted_at IS NULL
    JOIN product p ON p.id=pc.product_id AND p.deleted_at IS NULL
      AND p.status='published'
    JOIN product_variant v ON v.product_id=p.id AND v.deleted_at IS NULL
    JOIN region r ON r.currency_code='eur' AND r.deleted_at IS NULL
    WHERE k.type='publishable' AND k.deleted_at IS NULL AND k.revoked_at IS NULL;"""
    rows = target.source(source_container, query)
    if not isinstance(rows, list) or not rows or any(
            not isinstance(row, dict) or any(
                not isinstance(row.get(name), str) or not re.fullmatch(r"[A-Za-z0-9_-]+", row[name])
                for name in ("product_id", "variant_id", "sales_channel_id",
                             "publishable_key_id", "region_id", "currency_code"))
            for row in rows):
        raise RuntimeError("published Store API contexts missing or malformed")
    return rows


FETCH = r"""
const input=JSON.parse(await new Promise((resolve,reject)=>{
  let body=''; process.stdin.setEncoding('utf8');
  process.stdin.on('data',part=>{body+=part;if(body.length>100000)reject(Error('input_too_large'))});
  process.stdin.on('end',()=>resolve(body)); process.stdin.on('error',reject);
}));
const output=[];
for(let i=0;i<input.products.length;i+=4){
  const batch=await Promise.all(input.products.slice(i,i+4).map(async product=>{
    const q=new URLSearchParams({fields:'*variants.calculated_price,+variants.inventory_quantity',
      region_id:product.region_id});
    const u='http://127.0.0.1:9000/store/products/'+encodeURIComponent(product.product_id)+'?'+q;
    const res=await fetch(u,{headers:{'x-publishable-api-key':input.token},
      signal:AbortSignal.timeout(10000)});
    if(!res.ok)return {product_id:product.product_id,http_status:res.status};
    const json=await res.json();
    return {product_id:product.product_id,http_status:res.status,
      variants:(json.product?.variants??[]).map(v=>({variant_id:v.id,
        inventory_quantity:v.inventory_quantity??null,
        calculated_amount:v.calculated_price?.calculated_amount??null,
        currency_code:v.calculated_price?.currency_code??null}))};
  }));
  output.push(...batch);
}
process.stdout.write(JSON.stringify(output)+'\n');
"""


def store_products(backend_container, source_container, key_id, products):
    if not re.fullmatch(r"apk_[A-Za-z0-9]+", key_id):
        raise RuntimeError("invalid publishable key ID")
    token = target.source(source_container,
        "SELECT to_json(token)::text FROM api_key WHERE id='" + key_id +
        "' AND type='publishable' AND revoked_at IS NULL AND deleted_at IS NULL;")
    if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9._-]{12,256}", token):
        raise RuntimeError("active Store API token unavailable")
    result = subprocess.run(["docker", "exec", "-i", backend_container,
                             "node", "--input-type=module", "-e", FETCH],
                            input=json.dumps({"token": token, "products": products}),
                            text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError("Store API batch lookup failed")
    output = json.loads(result.stdout)
    if len(output) != len(products) or any(row.get("http_status") != 200 for row in output):
        raise RuntimeError("Store API did not return every product")
    return {row["product_id"]: row for row in output}


def run(args):
    before = comparison.verify(args)
    if not comparison.numeric_consistent(args.source_container):
        raise RuntimeError("Medusa numeric/raw values disagree")
    _, catalog = target.catalog_rows(args.source_container, args.pipeline_container,
                                     "cdc11_catalog_epoch1")
    _, stage = target.stage2_rows(args.source_container, args.pipeline_container,
                                  "cdc11_inventory_price_epoch1")
    products = {row["id"]: row for row in catalog["product"]}
    variants = {row["id"]: row for row in catalog["product_variant"]}
    selected = contexts(args.source_container)
    keys = collections.defaultdict(dict)
    for row in selected:
        prior = keys[row["publishable_key_id"]].get(row["product_id"])
        if prior and prior["region_id"] != row["region_id"]:
            raise RuntimeError("multiple regions for one Store API product request")
        keys[row["publishable_key_id"]][row["product_id"]] = {
            "product_id": row["product_id"], "region_id": row["region_id"]}
    observed = {}
    for key_id, group in keys.items():
        for product_id, response in store_products(args.backend_container,
                args.source_container, key_id, list(group.values())).items():
            observed[(key_id, product_id)] = response
    mismatches = []
    checked = managed = 0
    for row in selected:
        product, variant = products.get(row["product_id"]), variants.get(row["variant_id"])
        if not product or not variant or product["deleted"] or variant["deleted"]:
            mismatches.append({"variant_id": row["variant_id"], "reason": "catalog_missing"})
            continue
        product_arg = {"product_id": product["id"], "status": product["status"],
                       "soft_deleted": product["deleted"]}
        variant_arg = {"variant_id": variant["id"], "product_id": variant["product_id"],
                       "manage_inventory": variant["manage_inventory"],
                       "allow_backorder": variant["allow_backorder"],
                       "soft_deleted": variant["deleted"]}
        tables = before["inventory_price"]["table_counts"]
        inventory = resolver.resolve_inventory(stage, product=product_arg,
            variant=variant_arg, sales_channel_id=row["sales_channel_id"],
            context_reconciled=True, verified_tables=tables)
        price = resolver.resolve_default_price(stage, variant_id=variant["id"],
            currency_code=row["currency_code"], region_id=row["region_id"],
            context_reconciled=True, verified_tables=tables)
        api_variants = observed[(row["publishable_key_id"], row["product_id"])]["variants"]
        api = next((item for item in api_variants if item["variant_id"] == variant["id"]), None)
        if inventory["status"] != "PASS_SAMPLE_ONLY" or price["status"] != "PASS_SAMPLE_ONLY" or not api:
            mismatches.append({"variant_id": variant["id"], "reason": "resolver_or_api_unverified"})
            continue
        if (api["calculated_amount"] is None or
                api["currency_code"] != price["currency_code"] or
                Decimal(str(api["calculated_amount"])) != Decimal(price["amount"])):
            mismatches.append({"variant_id": variant["id"], "reason": "price_mismatch"})
            continue
        if variant["manage_inventory"] is True:
            managed += 1
            if inventory["inventory_quantity"] != api["inventory_quantity"]:
                mismatches.append({"variant_id": variant["id"], "reason": "inventory_mismatch"})
                continue
        checked += 1
    after = comparison.verify(args)
    if not comparison.stable(before, after):
        raise RuntimeError("target CDC source/projection changed during Store API comparison")
    return {"status": "PASS_CURRENT_SOURCE_SHAPES_ONLY" if not mismatches else
            "BLOCKED_BY_QUALITY", "contexts": checked + len(mismatches),
            "matched": checked, "managed_inventory_compared": managed,
            "mismatch_count": len(mismatches), "mismatches": mismatches[:10],
            "publishable_keys": len(keys)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile-dir", type=Path, required=True)
    parser.add_argument("--source-container", required=True)
    parser.add_argument("--pipeline-container", required=True)
    parser.add_argument("--kafka-container", required=True)
    parser.add_argument("--connect-container", required=True)
    parser.add_argument("--backend-container", required=True)
    args = parser.parse_args()
    if args.source_container != "medusa_reference-postgres-1" or \
            args.backend_container != "medusa_reference-backend-1" or any(
            not re.fullmatch(r"[a-f0-9]{12,64}", value) for value in
            (args.pipeline_container, args.kafka_container, args.connect_container)):
        raise ValueError("exact CDC-11 target containers required")
    result = run(args)
    print(json.dumps(result, sort_keys=True))
    return 0 if result["status"] == "PASS_CURRENT_SOURCE_SHAPES_ONLY" else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, KeyError, TypeError, OSError) as error:
        raise SystemExit(f"target-stage2-all-store-api: {error}") from None
