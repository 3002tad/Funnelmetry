"""Shadow-only Medusa inventory/price resolver over governed CDC context.

Conformed shapes: one item across verified locations, or a multi-item kit at
one verified location. Only simple default prices have been conformed. Other
shapes remain UNVERIFIED; no customer-facing asset is active.
"""

from decimal import Decimal, InvalidOperation, ROUND_FLOOR


TABLES = frozenset({
    "product_sales_channel", "sales_channel", "sales_channel_stock_location",
    "stock_location", "product_variant_inventory_item", "inventory_item",
    "inventory_level", "reservation_item", "product_variant_price_set",
    "price_set", "price", "price_list", "price_rule", "price_list_rule",
    "region", "currency",
})


def _coverage(rows, context_reconciled, verified_tables):
    # Empty source tables have no row in the grouped context query. Coverage
    # must come from the independent 16-table verifier, not row presence.
    return (context_reconciled is True and verified_tables is not None and
            TABLES <= set(verified_tables) and set(rows) <= TABLES)


def _active(rows, table):
    return [entry["payload"] for entry in rows.get(table, [])
            if entry.get("soft_deleted") is False and isinstance(entry.get("payload"), dict)]


def _number(value):
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None
    return result if result.is_finite() else None


def _one(values):
    return values[0] if len(values) == 1 else None


def resolve_inventory(rows, *, product, variant, sales_channel_id,
                      context_reconciled=False, verified_tables=None):
    """Resolve the narrow proven Store API shape; fail closed for other shapes."""
    if not _coverage(rows, context_reconciled, verified_tables):
        return {"status": "BLOCKED_BY_QUALITY", "reason": "cdc_context_not_reconciled"}
    if not product or not variant or product.get("soft_deleted") or variant.get("soft_deleted"):
        return {"status": "UNVERIFIED", "reason": "catalog_entity_missing_or_deleted"}
    if product.get("status") != "published" or variant.get("product_id") != product.get("product_id"):
        return {"status": "UNVERIFIED", "reason": "product_not_visible"}
    product_id = product["product_id"]
    variant_id = variant["variant_id"]
    channels = [r for r in _active(rows, "product_sales_channel")
                if r.get("product_id") == product_id and r.get("sales_channel_id") == sales_channel_id]
    channel = _one([r for r in _active(rows, "sales_channel")
                    if r.get("id") == sales_channel_id])
    if len(channels) != 1 or channel is None or channel.get("is_disabled") is not False:
        return {"status": "UNVERIFIED", "reason": "sales_channel_ineligible"}
    if variant.get("manage_inventory") is False:
        return {"status": "PASS_SAMPLE_ONLY", "inventory_quantity": None,
                "purchasable": True, "reason": "inventory_not_managed"}
    if variant.get("manage_inventory") is not True:
        return {"status": "UNVERIFIED", "reason": "inventory_management_unknown"}
    if variant.get("allow_backorder") is not False:
        return {"status": "UNVERIFIED", "reason": "backorder_not_conformed"}
    links = [r for r in _active(rows, "product_variant_inventory_item")
             if r.get("variant_id") == variant_id]
    if not links:
        return {"status": "UNVERIFIED", "reason": "inventory_item_link_missing"}
    if len({link.get("inventory_item_id") for link in links}) != len(links):
        return {"status": "BLOCKED_BY_QUALITY", "reason": "duplicate_inventory_item_link"}
    locations = {r.get("stock_location_id") for r in
                 _active(rows, "sales_channel_stock_location")
                 if r.get("sales_channel_id") == sales_channel_id}
    active_locations = {r.get("id") for r in _active(rows, "stock_location")}
    locations &= active_locations
    if not locations or None in locations:
        return {"status": "UNVERIFIED", "reason": "stock_location_missing"}
    quantities = []
    level_count = 0
    for link in links:
        item_id = link.get("inventory_item_id")
        required = _number(link.get("required_quantity"))
        item = _one([r for r in _active(rows, "inventory_item") if r.get("id") == item_id])
        if item is None or required is None or required <= 0:
            return {"status": "UNVERIFIED", "reason": "inventory_kit_relation_invalid"}
        available = Decimal(0)
        levels = [r for r in _active(rows, "inventory_level")
                  if r.get("inventory_item_id") == item_id and r.get("location_id") in locations]
        if len({r.get("location_id") for r in levels}) != len(levels):
            return {"status": "BLOCKED_BY_QUALITY", "reason": "duplicate_inventory_level"}
        level_count += len(levels)
        for level in levels:
            stocked = _number(level.get("stocked_quantity"))
            reserved = _number(level.get("reserved_quantity"))
            reservations = [_number(r.get("quantity")) for r in
                            _active(rows, "reservation_item")
                            if r.get("inventory_item_id") == item_id and
                            r.get("location_id") == level.get("location_id")]
            if stocked is None or reserved is None or any(n is None for n in reservations):
                return {"status": "BLOCKED_BY_QUALITY", "reason": "invalid_inventory_quantity"}
            if reserved != sum(reservations, Decimal(0)):
                return {"status": "UNVERIFIED", "reason": "reservation_level_mismatch"}
            available += max(Decimal(0), stocked - reserved)
        quantities.append(int((available / required).to_integral_value(rounding=ROUND_FLOOR)))
    candidate = min(quantities)
    if len(links) > 1:
        if len(locations) != 1 or level_count != len(links):
            return {"status": "UNVERIFIED", "reason": "kit_multi_location_or_level_missing"}
        return {"status": "PASS_SAMPLE_ONLY", "inventory_quantity": candidate,
                "purchasable": candidate > 0,
                "reason": "inventory_kit_single_location_conformed"}
    if level_count != len(locations) or \
            _number(links[0].get("required_quantity")) != 1:
        return {"status": "UNVERIFIED", "reason": "single_item_shape_not_conformed"}
    return {"status": "PASS_SAMPLE_ONLY", "inventory_quantity": candidate,
            "purchasable": candidate > 0,
            "reason": "single_item_locations_conformed"}


def resolve_default_price(rows, *, variant_id, currency_code, region_id,
                          context_reconciled=False, verified_tables=None):
    """A simple default price candidate, never a historical order amount."""
    if not _coverage(rows, context_reconciled, verified_tables):
        return {"status": "BLOCKED_BY_QUALITY", "reason": "cdc_context_not_reconciled"}
    region = _one([r for r in _active(rows, "region") if r.get("id") == region_id])
    currency = _one([r for r in _active(rows, "currency") if r.get("code") == currency_code])
    if region is None or currency is None or region.get("currency_code") != currency_code:
        return {"status": "UNVERIFIED", "reason": "currency_or_region_missing"}
    links = [r for r in _active(rows, "product_variant_price_set")
             if r.get("variant_id") == variant_id]
    if len(links) != 1:
        return {"status": "UNVERIFIED", "reason": "price_set_binding_ambiguous"}
    price_set_id = links[0].get("price_set_id")
    if _one([r for r in _active(rows, "price_set") if r.get("id") == price_set_id]) is None:
        return {"status": "UNVERIFIED", "reason": "price_set_missing"}
    candidates = [r for r in _active(rows, "price")
                  if r.get("price_set_id") == price_set_id and
                  r.get("currency_code") == currency_code]
    if any(r.get("price_list_id") is not None or r.get("rules_count") != 0 or
           r.get("min_quantity") is not None or r.get("max_quantity") is not None
           for r in candidates):
        return {"status": "UNVERIFIED", "reason": "price_list_rule_or_tier_requires_context"}
    price = _one(candidates)
    amount = _number(price.get("amount")) if price else None
    if amount is None or amount < 0:
        return {"status": "UNVERIFIED", "reason": "default_price_missing_or_ambiguous"}
    if any(r.get("price_id") == price.get("id") for r in _active(rows, "price_rule")):
        return {"status": "UNVERIFIED", "reason": "price_rule_requires_context"}
    return {"status": "PASS_SAMPLE_ONLY", "amount": str(amount),
            "currency_code": currency_code, "reason": "simple_default_price_conformed"}
