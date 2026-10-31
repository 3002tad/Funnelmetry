"""Read-only inventory/price table allowlist for the active CDC verifier.

Physical slot/topic names retain ``shadow`` for offset continuity. This module
does not create connectors, publications, slots, or analytical bindings.
"""

TABLES = {
    "product_sales_channel": ("id", "product_id", "sales_channel_id", "deleted_at"),
    "sales_channel": ("id", "name", "is_disabled", "deleted_at"),
    "sales_channel_stock_location": ("id", "sales_channel_id", "stock_location_id", "deleted_at"),
    "stock_location": ("id", "name", "deleted_at"),
    "product_variant_inventory_item": ("id", "variant_id", "inventory_item_id", "required_quantity", "deleted_at"),
    "inventory_item": ("id", "sku", "requires_shipping", "deleted_at"),
    "inventory_level": ("id", "inventory_item_id", "location_id", "stocked_quantity",
                        "reserved_quantity", "incoming_quantity", "deleted_at"),
    "reservation_item": ("id", "inventory_item_id", "location_id", "quantity", "allow_backorder", "deleted_at"),
    "product_variant_price_set": ("id", "variant_id", "price_set_id", "deleted_at"),
    "price_set": ("id", "deleted_at"),
    "price": ("id", "price_set_id", "currency_code", "amount", "price_list_id",
              "min_quantity", "max_quantity", "rules_count", "deleted_at"),
    "price_list": ("id", "status", "starts_at", "ends_at", "type", "rules_count", "deleted_at"),
    "price_rule": ("id", "price_id", "attribute", "operator", "value", "priority", "deleted_at"),
    "price_list_rule": ("id", "price_list_id", "attribute", "value", "deleted_at"),
    "region": ("id", "currency_code", "deleted_at"),
    "currency": ("code", "decimal_digits", "deleted_at"),
}

SLOT = "funnelmetry_cdc_inventory_price_shadow_v2"
PREFIX = "cdc_shadow_medusa_inventory_price_v2"
CONNECTOR = "medusa-cdc-inventory-price-shadow-v2"
