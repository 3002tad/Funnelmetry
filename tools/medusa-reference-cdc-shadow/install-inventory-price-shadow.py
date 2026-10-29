#!/usr/bin/env python3
"""Install the separate inventory/price context connector on an isolated clone.

This operator-side installer never publishes inventory availability or a
storefront display price. It shares guarded source setup with catalog stage 1,
but owns a distinct role, publication, slot, connector, topic prefix and state.
"""

import importlib.util
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("catalog_table_installer", ROOT / "install-catalog-shadow.py")
table_installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(table_installer)

TABLES = {
    "product_sales_channel": ("id", "product_id", "sales_channel_id"),
    "sales_channel": ("id", "name", "is_disabled"),
    "sales_channel_stock_location": ("id", "sales_channel_id", "stock_location_id"),
    "stock_location": ("id", "name"),
    "product_variant_inventory_item": ("id", "variant_id", "inventory_item_id", "required_quantity"),
    "inventory_item": ("id", "sku", "requires_shipping", "deleted_at"),
    "inventory_level": ("id", "inventory_item_id", "location_id", "stocked_quantity",
                        "reserved_quantity", "incoming_quantity"),
    "reservation_item": ("id", "inventory_item_id", "location_id", "quantity", "allow_backorder"),
    "product_variant_price_set": ("id", "variant_id", "price_set_id"),
    "price_set": ("id",),
    "price": ("id", "price_set_id", "currency_code", "amount", "price_list_id",
              "min_quantity", "max_quantity", "rules_count", "deleted_at"),
    "price_list": ("id", "status", "starts_at", "ends_at", "type", "rules_count", "deleted_at"),
    "price_rule": ("id", "price_id", "attribute", "operator", "value", "priority"),
    "price_list_rule": ("id", "price_list_id", "attribute", "value"),
    "region": ("id", "currency_code"),
    "currency": ("code", "decimal_digits", "deleted_at"),
}
PRIMARY_KEYS = {
    "product_sales_channel": ("product_id", "sales_channel_id"),
    "sales_channel_stock_location": ("sales_channel_id", "stock_location_id"),
    "product_variant_inventory_item": ("variant_id", "inventory_item_id"),
    "product_variant_price_set": ("variant_id", "price_set_id"),
    "currency": ("code",),
    **{table: ("id",) for table in TABLES if table not in {
        "product_sales_channel", "sales_channel_stock_location",
        "product_variant_inventory_item", "product_variant_price_set", "currency"}},
}

SLOT = "funnelmetry_cdc_inventory_price_shadow"
PREFIX = "cdc_shadow_medusa_inventory_price"
EXPECTED = {
    "schema_version": "funnelmetry-medusa-cdc-inventory-price-shadow.v1",
    "generated_by": "funnelmetry-medusa-ci", "status": "SHADOW_ONLY",
    "source_id": "medusa-reference", "medusa_version": "2.19.0",
    "cdc_inventory_price_contract": "reference.medusa.inventory_price_context.v1",
    "source_db_url_ref": "FUNNELMETRY_CDC_INVENTORY_PRICE_DATABASE_URL",
    "snapshot_mode": "initial", "publication": SLOT, "slot": SLOT,
    "topic_prefix": PREFIX,
    "table_columns": [f"public.{table}:{','.join(columns)}" for table, columns in TABLES.items()],
    "projection_stage": "INVENTORY_PRICE_CONTEXT_ONLY",
    "inventory_available_to_sell_claims": "NOT_PUBLISHED",
    "storefront_display_price_claims": "NOT_PUBLISHED",
    "historical_order_amount_restatement": "FORBIDDEN",
    "runtime_activation": "OPERATOR_CONTROLLED_SEPARATE_FROM_INSTALLER",
}

table_installer.configure_profile(
    project_pattern=r"funnelmetry_cdc_inventory_price_shadow_[a-z0-9][a-z0-9_-]{0,32}",
    state=ROOT / "private" / "cdc-inventory-price-installer-state.json",
    secret=ROOT / "private" / "inventory-price-connector.env",
    connector="medusa-cdc-inventory-price-shadow", prefix=PREFIX,
    slot=SLOT, publication=SLOT, role="cdc_inventory_price", tables=TABLES,
    expected=EXPECTED, primary_keys=PRIMARY_KEYS,
)


if __name__ == "__main__":
    try:
        table_installer.main()
    except (ValueError, RuntimeError, OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"cdc-inventory-price-shadow-installer: {error}") from None
