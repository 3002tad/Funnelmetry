"""Fail-closed product/variant input from the governed catalog CDC projection.

The caller must obtain rows and the quality lease in one repeatable-read query.
This is a clone candidate, not an activated catalog or inventory asset.
"""

from datetime import datetime, timezone

TABLES = frozenset({"product", "product_variant", "product_category",
                    "product_category_product"})
TOPICS = frozenset(f"cdc_shadow_medusa_catalog.public.{table}" for table in TABLES)


def _expiry(value):
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        return None
    return parsed if parsed.tzinfo is not None else None


def resolve_pair(observation, *, source_id, coverage_epoch_id, now=None):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError("now must have a timezone")
    quality = observation.get("quality")
    current_offsets = observation.get("current_offsets")
    product = observation.get("product")
    variant = observation.get("variant")
    if not isinstance(quality, dict):
        return {"status": "BLOCKED_BY_QUALITY", "reason": "catalog_quality_missing"}
    expiry = _expiry(quality.get("valid_until"))
    source_counts = quality.get("source_row_counts")
    target_counts = quality.get("projection_row_counts")
    ends = quality.get("topic_end_offsets")
    applied = quality.get("applied_offsets")
    if (quality.get("source_id") != source_id or
            quality.get("coverage_epoch_id") != coverage_epoch_id or
            quality.get("status") != "PASS" or
            quality.get("snapshot_complete") is not True or
            quality.get("connector_running") is not True or
            quality.get("slot_status") not in ("reserved", "extended") or
            not quality.get("source_digest") or
            quality.get("source_digest") != quality.get("projection_digest") or
            not isinstance(source_counts, dict) or set(source_counts) != TABLES or
            not isinstance(target_counts, dict) or source_counts != target_counts or
            not isinstance(ends, dict) or set(ends) != TOPICS or
            not isinstance(applied, dict) or ends != applied or
            not isinstance(current_offsets, dict) or current_offsets != applied or
            expiry is None or expiry <= now):
        return {"status": "BLOCKED_BY_QUALITY", "reason": "catalog_quality_not_current"}
    if not isinstance(product, dict) or not isinstance(variant, dict):
        return {"status": "UNVERIFIED", "reason": "catalog_entity_missing"}
    if (product.get("source_id") != source_id or variant.get("source_id") != source_id or
            product.get("coverage_epoch_id") != coverage_epoch_id or
            variant.get("coverage_epoch_id") != coverage_epoch_id or
            variant.get("product_id") != product.get("product_id")):
        return {"status": "BLOCKED_BY_QUALITY", "reason": "catalog_key_or_relation_mismatch"}
    return {"status": "PASS_CONTEXT_ONLY", "product": product, "variant": variant}
