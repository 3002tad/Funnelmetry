"""Context lease digest normalizes PostgreSQL text vs Debezium JSON values."""

import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "context_quality", ROOT / "publish-inventory-price-governed-quality.py")
quality = importlib.util.module_from_spec(spec)
spec.loader.exec_module(quality)


class ContextQualityTest(unittest.TestCase):
    def test_source_numeric_raw_mismatch_blocks_context_lease(self):
        self.assertTrue(quality.numeric.passed({"inventory_level_mismatch": 0,
                                                "price_mismatch": 0}))
        self.assertFalse(quality.numeric.passed({"inventory_level_mismatch": 1,
                                                 "price_mismatch": 0}))
        self.assertFalse(quality.numeric.passed({"inventory_level_mismatch": 0}))

    def test_digest_matches_selected_attributes_across_representations(self):
        source = {table: [] for table in quality.stage2.TABLES}
        target = {table: [] for table in quality.stage2.TABLES}
        source["inventory_level"] = [{"key": ["level_1"], "soft_deleted": False,
                                      "attributes": {"id": "level_1", "inventory_item_id": "item_1",
                                                     "location_id": "loc_1", "stocked_quantity": "10",
                                                     "reserved_quantity": "2", "incoming_quantity": "0"}}]
        target["inventory_level"] = [{"key": ["level_1"], "soft_deleted": False,
                                      "payload": {"id": "level_1", "inventory_item_id": "item_1",
                                                  "location_id": "loc_1", "stocked_quantity": 10,
                                                  "reserved_quantity": 2, "incoming_quantity": 0,
                                                  "deleted_at": None}}]
        source["price_list"] = [{"key": ["pl_1"], "soft_deleted": False,
                                 "attributes": {"id": "pl_1", "status": "active",
                                                "starts_at": "2026-10-29 00:00:00+00",
                                                "ends_at": None, "type": "sale", "rules_count": "1"}}]
        target["price_list"] = [{"key": ["pl_1"], "soft_deleted": False,
                                 "payload": {"id": "pl_1", "status": "active",
                                             "starts_at": 1793232000000000, "ends_at": None,
                                             "type": "sale", "rules_count": 1, "deleted_at": None}}]
        source["price_list_rule"] = [{"key": ["plr_1"], "soft_deleted": False,
                                      "attributes": {"id": "plr_1", "price_list_id": "pl_1",
                                                     "attribute": "region_id",
                                                     "value": '{"id":"reg_1"}'}}]
        target["price_list_rule"] = [{"key": ["plr_1"], "soft_deleted": False,
                                      "payload": {"id": "plr_1", "price_list_id": "pl_1",
                                                  "attribute": "region_id",
                                                  "value": {"id": "reg_1"}, "deleted_at": None}}]
        self.assertEqual(quality.digest(source, True), quality.digest(target, False))
        target["inventory_level"][0]["payload"]["reserved_quantity"] = 3
        self.assertNotEqual(quality.digest(source, True), quality.digest(target, False))


if __name__ == "__main__":
    unittest.main()
