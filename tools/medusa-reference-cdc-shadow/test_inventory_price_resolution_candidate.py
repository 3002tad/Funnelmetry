"""Semantic gates for CDC inventory and price context."""

import importlib.util
import unittest
from pathlib import Path


spec = importlib.util.spec_from_file_location(
    "resolution", Path(__file__).with_name("inventory_price_resolution_candidate.py"))
resolution = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resolution)


def row(**payload):
    return {"payload": payload, "soft_deleted": False}


def context():
    return {
        "product_sales_channel": [row(product_id="prod_1", sales_channel_id="sc_1")],
        "sales_channel": [row(id="sc_1", is_disabled=False)],
        "sales_channel_stock_location": [row(sales_channel_id="sc_1", stock_location_id="loc_1")],
        "stock_location": [row(id="loc_1")],
        "product_variant_inventory_item": [row(variant_id="var_1", inventory_item_id="item_1",
                                               required_quantity="1")],
        "inventory_item": [row(id="item_1")],
        "inventory_level": [row(inventory_item_id="item_1", location_id="loc_1",
                                stocked_quantity="10", reserved_quantity="2")],
        "reservation_item": [row(inventory_item_id="item_1", location_id="loc_1", quantity="2")],
        "product_variant_price_set": [row(variant_id="var_1", price_set_id="ps_1")],
        "price_set": [row(id="ps_1")],
        "price": [row(id="price_1", price_set_id="ps_1", currency_code="eur", amount="15.5",
                      price_list_id=None, rules_count=0, min_quantity=None, max_quantity=None)],
        "price_rule": [], "price_list": [], "price_list_rule": [],
        "region": [row(id="reg_1", currency_code="eur")],
        "currency": [row(code="eur", decimal_digits=2)],
    }


PRODUCT = {"product_id": "prod_1", "status": "published", "soft_deleted": False}
VARIANT = {"variant_id": "var_1", "product_id": "prod_1", "soft_deleted": False,
           "manage_inventory": True, "allow_backorder": False}


def stock(data, variant=VARIANT):
    return resolution.resolve_inventory(data, product=PRODUCT, variant=variant,
                                        sales_channel_id="sc_1", context_reconciled=True,
                                        verified_tables=resolution.TABLES)


class ResolverTests(unittest.TestCase):
    def test_single_item_location_and_reservation(self):
        self.assertEqual(stock(context())["inventory_quantity"], 8)
        self.assertEqual(stock(context())["status"], "PASS_SAMPLE_ONLY")

    def test_missing_capture_or_quality_never_resolves(self):
        self.assertEqual(resolution.resolve_inventory(
            context(), product=PRODUCT, variant=VARIANT,
            sales_channel_id="sc_1")["status"], "BLOCKED_BY_QUALITY")
        data = context()
        data.pop("price_rule")
        self.assertEqual(resolution.resolve_inventory(
            data, product=PRODUCT, variant=VARIANT, sales_channel_id="sc_1",
            context_reconciled=True, verified_tables=resolution.TABLES - {"price_rule"}
        )["status"], "BLOCKED_BY_QUALITY")

    def test_empty_verified_tables_need_no_grouped_context_key(self):
        data = context()
        data.pop("price_rule")
        data.pop("price_list_rule")
        self.assertEqual(stock(data)["status"], "PASS_SAMPLE_ONLY")

    def test_unmanaged_variant_is_purchasable_without_quantity(self):
        variant = {**VARIANT, "manage_inventory": False}
        result = stock(context(), variant)
        self.assertIsNone(result["inventory_quantity"])
        self.assertTrue(result["purchasable"])

    def test_reservation_level_mismatch_blocks_quantity(self):
        data = context()
        data["reservation_item"][0]["payload"]["quantity"] = "3"
        result = stock(data)
        self.assertEqual(result["status"], "UNVERIFIED")
        self.assertNotIn("inventory_quantity", result)

    def test_multiple_locations_require_store_api_conformance(self):
        data = context()
        data["stock_location"].append(row(id="loc_2"))
        data["sales_channel_stock_location"].append(
            row(sales_channel_id="sc_1", stock_location_id="loc_2"))
        data["inventory_level"].append(row(inventory_item_id="item_1", location_id="loc_2",
                                           stocked_quantity="5", reserved_quantity="0"))
        result = stock(data)
        self.assertEqual(result["status"], "UNVERIFIED")
        self.assertNotIn("inventory_quantity", result)

    def test_simple_default_price_is_currency_scoped(self):
        result = resolution.resolve_default_price(context(), variant_id="var_1",
                                                  currency_code="eur", region_id="reg_1",
                                                  context_reconciled=True,
                                                  verified_tables=resolution.TABLES)
        self.assertEqual((result["status"], result["amount"]), ("PASS_SAMPLE_ONLY", "15.5"))
        self.assertEqual(resolution.resolve_default_price(context(), variant_id="var_1",
                        currency_code="usd", region_id="reg_1",
                        context_reconciled=True,
                        verified_tables=resolution.TABLES)["status"], "UNVERIFIED")

    def test_list_price_and_quantity_tier_never_masquerade_as_default(self):
        data = context()
        data["price"].append(row(id="price_2", price_set_id="ps_1", currency_code="eur",
                                 amount="8", price_list_id="list_1", rules_count=0,
                                 min_quantity=None, max_quantity=None))
        result = resolution.resolve_default_price(data, variant_id="var_1",
                                                  currency_code="eur", region_id="reg_1",
                                                  context_reconciled=True,
                                                  verified_tables=resolution.TABLES)
        self.assertEqual(result["status"], "UNVERIFIED")
        self.assertNotIn("amount", result)
        data["price"].pop()
        data["price"][0]["payload"]["min_quantity"] = 10
        self.assertEqual(resolution.resolve_default_price(data, variant_id="var_1",
                         currency_code="eur", region_id="reg_1",
                         context_reconciled=True,
                         verified_tables=resolution.TABLES)["status"], "UNVERIFIED")


if __name__ == "__main__":
    unittest.main()
