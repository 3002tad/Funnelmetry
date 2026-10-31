#!/usr/bin/env python3
"""Count which published Medusa variant contexts the CDC resolver can assess.

This is a read-only shape audit, not Store API conformance or asset activation.
It requires two passing target source/projection checks around its CDC reads.
"""

import argparse
import collections
import importlib.util
import json
import re
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


def active(rows, table):
    return [row["payload"] for row in rows.get(table, [])
            if row.get("soft_deleted") is False and isinstance(row.get("payload"), dict)]


def audit(args):
    before = comparison.verify(args)
    _, catalog = target.catalog_rows(args.source_container, args.pipeline_container,
                                     "cdc11_catalog_epoch1")
    _, stage = target.stage2_rows(args.source_container, args.pipeline_container,
                                  "cdc11_inventory_price_epoch1")
    products = {row["id"]: row for row in catalog["product"]
                if not row["deleted"] and row["status"] == "published"}
    variants = [row for row in catalog["product_variant"]
                if not row["deleted"] and row["product_id"] in products]
    channels = collections.defaultdict(set)
    for row in active(stage, "product_sales_channel"):
        channels[row.get("product_id")].add(row.get("sales_channel_id"))
    regions = [(row.get("id"), row.get("currency_code"))
               for row in active(stage, "region")]
    inventory_reasons = collections.Counter()
    price_reasons = collections.Counter()
    inventory_resolved = set()
    price_resolved = set()
    contexts = 0
    for variant in variants:
        product_id = variant["product_id"]
        product = {"product_id": product_id, "status": products[product_id]["status"],
                   "soft_deleted": False}
        item = {"variant_id": variant["id"], "product_id": product_id,
                "manage_inventory": variant["manage_inventory"],
                "allow_backorder": variant["allow_backorder"], "soft_deleted": False}
        for channel_id in sorted(channels.get(product_id, ())):
            for region_id, currency_code in regions:
                if not all((channel_id, region_id, currency_code)):
                    continue
                contexts += 1
                inventory = resolver.resolve_inventory(stage, product=product,
                    variant=item, sales_channel_id=channel_id,
                    context_reconciled=True, verified_tables=before["inventory_price"]["table_counts"])
                price = resolver.resolve_default_price(stage, variant_id=variant["id"],
                    currency_code=currency_code, region_id=region_id,
                    context_reconciled=True, verified_tables=before["inventory_price"]["table_counts"])
                inventory_reasons[f"{inventory['status']}:{inventory['reason']}"] += 1
                price_reasons[f"{price['status']}:{price['reason']}"] += 1
                if inventory["status"] == "PASS_SAMPLE_ONLY":
                    inventory_resolved.add(variant["id"])
                if price["status"] == "PASS_SAMPLE_ONLY":
                    price_resolved.add(variant["id"])
    if not variants or not contexts:
        raise RuntimeError("no published CDC variant/channel/region context to audit")
    after = comparison.verify(args)
    if not comparison.stable(before, after):
        raise RuntimeError("target CDC source/projection changed during coverage audit")
    return {"status": "PASS_SHAPE_AUDIT_ONLY", "published_variants": len(variants),
            "contexts": contexts, "regions": len(regions),
            "inventory_resolved_variants": len(inventory_resolved),
            "price_resolved_variants": len(price_resolved),
            "inventory_reasons": dict(sorted(inventory_reasons.items())),
            "price_reasons": dict(sorted(price_reasons.items())),
            "source_rows": {table: len(active(stage, table)) for table in
                            ("reservation_item", "price_list", "price_rule", "price_list_rule")}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile-dir", type=Path, required=True)
    parser.add_argument("--source-container", required=True)
    parser.add_argument("--pipeline-container", required=True)
    parser.add_argument("--kafka-container", required=True)
    parser.add_argument("--connect-container", required=True)
    args = parser.parse_args()
    if args.source_container != "medusa_reference-postgres-1" or any(
            not re.fullmatch(r"[a-f0-9]{12,64}", value) for value in
            (args.pipeline_container, args.kafka_container, args.connect_container)):
        raise ValueError("exact CDC-11 target containers required")
    print(json.dumps(audit(args), sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, KeyError, TypeError, OSError) as error:
        raise SystemExit(f"target-stage2-shape-audit: {error}") from None
