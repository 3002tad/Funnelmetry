#!/usr/bin/env python3
"""Compare candidate Pipeline catalog CDC tables with an isolated source clone."""

import importlib.util
import json
import os
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("catalog_shadow_verifier", ROOT / "verify-catalog-shadow.py")
old = importlib.util.module_from_spec(spec)
spec.loader.exec_module(old)
EPOCH = os.environ.get("CATALOG_CDC_COVERAGE_EPOCH", "")


def projection():
    if not EPOCH or not all(char.isalnum() or char in "_-" for char in EPOCH):
        raise ValueError("set CATALOG_CDC_COVERAGE_EPOCH")
    return old.sql(old.PROJECTION, "catalog-projection-db", "catalog_projection",
                   "catalog_projection", f'''
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT json_build_object(
 'product', (SELECT COALESCE(json_agg(json_build_object('id',product_id,
   'title',title,'handle',handle,'status',status,'collection_id',collection_id,
   'updated_at',source_updated_raw,'deleted',soft_deleted)
   ORDER BY product_id),'[]'::json) FROM catalog_cdc_products_current
   WHERE source_id='medusa-reference' AND coverage_epoch_id='{EPOCH}'),
 'product_variant', (SELECT COALESCE(json_agg(json_build_object('id',variant_id,
   'product_id',product_id,'title',title,'sku',sku,
   'manage_inventory',manage_inventory,'allow_backorder',allow_backorder,
   'updated_at',source_updated_raw,'deleted',soft_deleted)
   ORDER BY variant_id),'[]'::json) FROM catalog_cdc_variants_current
   WHERE source_id='medusa-reference' AND coverage_epoch_id='{EPOCH}'),
 'product_category', (SELECT COALESCE(json_agg(json_build_object('id',category_id,
   'name',name,'parent_category_id',parent_category_id,
   'is_active',is_active,'is_internal',is_internal,
   'updated_at',source_updated_raw,'deleted',soft_deleted)
   ORDER BY category_id),'[]'::json) FROM catalog_cdc_categories_current
   WHERE source_id='medusa-reference' AND coverage_epoch_id='{EPOCH}'),
 'product_category_product', (SELECT COALESCE(json_agg(json_build_object(
   'product_id',product_id,'product_category_id',category_id)
   ORDER BY product_id,category_id),'[]'::json)
   FROM catalog_cdc_product_categories_current
   WHERE source_id='medusa-reference' AND coverage_epoch_id='{EPOCH}'),
 'snapshot_complete', (SELECT snapshot_last_seen FROM catalog_cdc_capture_status
   WHERE source_id='medusa-reference' AND coverage_epoch_id='{EPOCH}'),
 'input_offsets', (SELECT COALESCE(json_object_agg(topic,next_offset),'{{}}'::json)
   FROM catalog_cdc_input_offsets WHERE source_id='medusa-reference'
   AND coverage_epoch_id='{EPOCH}' AND partition=0),
 'audit_count', (SELECT count(*) FROM catalog_cdc_ingest_audit
   WHERE source_id='medusa-reference' AND coverage_epoch_id='{EPOCH}'),
 'orphan_variants', (SELECT count(*) FROM catalog_cdc_variants_current v
   LEFT JOIN catalog_cdc_products_current p ON p.source_id=v.source_id
      AND p.coverage_epoch_id=v.coverage_epoch_id AND p.product_id=v.product_id
   WHERE v.source_id='medusa-reference' AND v.coverage_epoch_id='{EPOCH}'
   AND p.product_id IS NULL),
 'orphan_category_links', (SELECT count(*) FROM catalog_cdc_product_categories_current pc
   LEFT JOIN catalog_cdc_products_current p ON p.source_id=pc.source_id
      AND p.coverage_epoch_id=pc.coverage_epoch_id AND p.product_id=pc.product_id
   LEFT JOIN catalog_cdc_categories_current c ON c.source_id=pc.source_id
      AND c.coverage_epoch_id=pc.coverage_epoch_id AND c.category_id=pc.category_id
   WHERE pc.source_id='medusa-reference' AND pc.coverage_epoch_id='{EPOCH}'
   AND (p.product_id IS NULL OR c.category_id IS NULL)))::text;
COMMIT;
''')


def main():
    if not old.PROJECT.fullmatch(os.environ.get("COMPOSE_PROJECT_NAME", "")):
        raise ValueError("requires isolated catalog clone project")
    deadline = time.monotonic() + 120
    while True:
        try:
            source = old.source()
        except RuntimeError:
            raise RuntimeError("source query failed") from None
        try:
            target = projection()
        except RuntimeError:
            raise RuntimeError("candidate projection query failed") from None
        try:
            ends = old.topic_ends()
        except RuntimeError:
            raise RuntimeError("topic offset query failed") from None
        try:
            running = old.connector_running()
        except RuntimeError:
            raise RuntimeError("connector query failed") from None
        result = old.evaluate(source, target, ends, running)
        if result["status"] == "PASS" or time.monotonic() >= deadline:
            print(json.dumps(result, sort_keys=True))
            return 0 if result["status"] == "PASS" else 1
        time.sleep(5)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, OSError) as error:
        raise SystemExit(f"catalog-governed-candidate-verifier: {error}") from None
