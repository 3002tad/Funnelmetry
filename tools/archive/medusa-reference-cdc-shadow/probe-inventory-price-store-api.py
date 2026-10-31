#!/usr/bin/env python3
"""Read-only Store API conformance sample against an isolated Medusa clone.

The publishable key remains in process memory and is never printed. This probe
does not establish inventory/price conformance for every context or rule.
"""

import json
import os
import re
import subprocess
import time


PROJECT = os.environ.get("COMPOSE_PROJECT_NAME", "")
if not re.fullmatch(r"funnelmetry_cdc_inventory_price_shadow_[a-z0-9][a-z0-9_-]{0,32}",
                    PROJECT):
    raise SystemExit("requires an isolated inventory/price clone project")


def quote(value):
    return "'" + value.replace("'", "''") + "'"


def sql(statement):
    command = ["docker", "exec", "-i", f"{PROJECT}-postgres-1", "psql", "-X",
               "-U", "medusa", "-d", "medusa", "-At", "-v", "ON_ERROR_STOP=1"]
    result = subprocess.run(command, input=statement, text=True,
                            capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError("clone PostgreSQL query failed")
    rows = [line for line in result.stdout.splitlines() if line.startswith("{")]
    if len(rows) != 1:
        raise RuntimeError("unexpected clone PostgreSQL result")
    return json.loads(rows[0])


sample = sql("""
SELECT json_build_object(
 'token', k.token, 'sales_channel_id', link.sales_channel_id,
 'product_id', v.product_id, 'variant_id', v.id,
 'manage_inventory', v.manage_inventory, 'allow_backorder', v.allow_backorder,
 'region_id', reg.id, 'currency_code', reg.currency_code)::text
FROM api_key k
JOIN publishable_api_key_sales_channel link
 ON link.publishable_key_id=k.id AND link.deleted_at IS NULL
JOIN product_sales_channel pc
 ON pc.sales_channel_id=link.sales_channel_id AND pc.deleted_at IS NULL
JOIN sales_channel sc ON sc.id=pc.sales_channel_id
 AND sc.deleted_at IS NULL AND NOT sc.is_disabled
JOIN product p ON p.id=pc.product_id AND p.deleted_at IS NULL
JOIN product_variant v ON v.product_id=p.id AND v.deleted_at IS NULL
CROSS JOIN LATERAL (SELECT id,currency_code FROM region
 WHERE deleted_at IS NULL ORDER BY id LIMIT 1) reg
WHERE k.type='publishable' AND k.deleted_at IS NULL AND k.revoked_at IS NULL
 AND v.manage_inventory AND p.status='published'
ORDER BY k.id,link.sales_channel_id,v.id LIMIT 1;
""")
token = sample.pop("token")
if not token:
    raise SystemExit("clone has no usable publishable key")

context = sql(f"""
SELECT json_build_object(
 'links', (SELECT COALESCE(json_agg(json_build_object(
   'item_id',vi.inventory_item_id,'required_quantity',vi.required_quantity,
   'location_id',l.stock_location_id,'stocked_quantity',il.stocked_quantity,
   'reserved_quantity',il.reserved_quantity)
   ORDER BY vi.inventory_item_id,l.stock_location_id),'[]'::json)
   FROM product_variant_inventory_item vi
   JOIN inventory_item item ON item.id=vi.inventory_item_id
     AND item.deleted_at IS NULL
   JOIN sales_channel_stock_location l
     ON l.sales_channel_id={quote(sample['sales_channel_id'])}
    AND l.deleted_at IS NULL
   JOIN stock_location loc ON loc.id=l.stock_location_id
     AND loc.deleted_at IS NULL
   LEFT JOIN inventory_level il ON il.inventory_item_id=vi.inventory_item_id
     AND il.location_id=l.stock_location_id AND il.deleted_at IS NULL
   WHERE vi.variant_id={quote(sample['variant_id'])} AND vi.deleted_at IS NULL),
 'prices', (SELECT COALESCE(json_agg(json_build_object(
   'price_id',pr.id,'amount',pr.amount,'price_list_id',pr.price_list_id,
   'min_quantity',pr.min_quantity,'max_quantity',pr.max_quantity,
   'rules_count',pr.rules_count) ORDER BY pr.id),'[]'::json)
   FROM product_variant_price_set vp
   JOIN price_set ps ON ps.id=vp.price_set_id AND ps.deleted_at IS NULL
   JOIN price pr ON pr.price_set_id=vp.price_set_id
   WHERE vp.variant_id={quote(sample['variant_id'])} AND vp.deleted_at IS NULL
     AND pr.deleted_at IS NULL AND pr.currency_code={quote(sample['currency_code'])})
)::text;
""")

request = {"token": token, "product_id": sample["product_id"],
           "variant_id": sample["variant_id"], "region_id": sample["region_id"]}
script = f"""
const input={json.dumps(request)};
const query=new URLSearchParams({{
  fields:'*variants.calculated_price,+variants.inventory_quantity',
  region_id:input.region_id
}});
const response=await fetch('http://127.0.0.1:9000/store/products/'+
  encodeURIComponent(input.product_id)+'?'+query.toString(),{{
    headers:{{'x-publishable-api-key':input.token}}
  }});
if(!response.ok){{console.log(JSON.stringify({{http_status:response.status}}));process.exit(2)}}
const body=await response.json();
const variant=(body.product?.variants??[]).find(v=>v.id===input.variant_id);
console.log(JSON.stringify({{
  http_status:response.status,variant_found:!!variant,
  inventory_quantity:variant?.inventory_quantity??null,
  calculated_amount:variant?.calculated_price?.calculated_amount??null,
  calculated_currency_code:variant?.calculated_price?.currency_code??null,
  price_list_type:variant?.calculated_price?.calculated_price?.price_list_type??null
}}));
"""
for attempt in range(30):
    result = subprocess.run(["docker", "exec", "-i", f"{PROJECT}-backend-1", "node", "-"],
                            input=script, text=True, capture_output=True, check=False)
    if result.returncode == 0:
        break
    if attempt == 29:
        raise SystemExit("clone Store API request failed after 90 seconds; inspect backend readiness")
    time.sleep(3)
lines = [line for line in result.stdout.splitlines() if line.startswith("{")]
if len(lines) != 1:
    raise SystemExit("unexpected clone Store API response")
store = json.loads(lines[0])
if store["http_status"] != 200 or not store["variant_found"]:
    raise SystemExit(f"clone Store API did not return variant: HTTP {store['http_status']}")

print(json.dumps({"status": "OBSERVED", "sample": sample, "db_context": context,
                  "store_api": store}, sort_keys=True))
